-- ============================================================
-- Fleximotion Ops App — PostgreSQL Database Schema
-- Version: 1.0
-- Date: 2026-05-28
-- Spec reference: Fleximotion-Ops-Spec-v0.4
-- ============================================================
-- Run order matters — forward references handled via ALTER TABLE
-- where circular FKs exist (e.g. vehicles ↔ operators).
--
-- All timestamps are TIMESTAMPTZ (UTC stored, Lagos WAT at display).
-- All dates are DATE aligned to Lagos calendar (Africa/Lagos, UTC+1).
-- All monetary values are NUMERIC(12, 2) in NGN.
-- Primary keys are UUID v4 via gen_random_uuid().
-- ============================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram index for fuzzy match in migration tool

-- ============================================================
-- SECTION 1: USERS & AUTHENTICATION
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL,
    email           TEXT,
    role            TEXT NOT NULL
                        CHECK (role IN ('operator', 'supervisor', 'manager', 'admin', 'owner')),
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'suspended')),
    pin_hash        TEXT,       -- bcrypt of 6-digit PIN; NULL until first login
    hr_user_id      TEXT,       -- external reference received from HR App via webhook
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);

ALTER TABLE users
    ADD CONSTRAINT uq_users_phone UNIQUE (phone),
    ADD CONSTRAINT uq_users_email UNIQUE (email),
    ADD CONSTRAINT uq_users_hr_user_id UNIQUE (hr_user_id);

COMMENT ON TABLE  users IS 'Unified identity record for every person in the system. Provisioned via HR App webhooks (user-activated event); not created directly in Ops App.';
COMMENT ON COLUMN users.role IS 'Primary role. A manager whose user_id also appears as operators.supervisor_id is treated as supervisor-capable for those operators at the API layer.';
COMMENT ON COLUMN users.hr_user_id IS 'Stable identifier passed in user-activated / user-updated webhooks from the HR App. Used for dedup and updates.';

CREATE INDEX idx_users_phone        ON users(phone);
CREATE INDEX idx_users_role_status  ON users(role, status);
CREATE INDEX idx_users_hr_user_id   ON users(hr_user_id) WHERE hr_user_id IS NOT NULL;

-- ------------------------------------
-- User devices (one row per registered device for FCM push)
-- ------------------------------------
CREATE TABLE IF NOT EXISTS user_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fcm_token       TEXT NOT NULL UNIQUE,
    device_name     TEXT,       -- user-visible label, e.g. "Wole's Tecno"
    user_agent      TEXT,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE user_devices IS 'One row per FCM-registered device per user. A user may have multiple devices. Tokens are invalidated on logout or FCM error.';

CREATE INDEX idx_user_devices_user_id  ON user_devices(user_id);
CREATE INDEX idx_user_devices_token    ON user_devices(fcm_token);

-- ------------------------------------
-- Refresh tokens for JWT session management
-- ------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,   -- SHA-256 of the opaque token value
    device_id       UUID REFERENCES user_devices(id) ON DELETE SET NULL,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_by      UUID REFERENCES users(id)
);

COMMENT ON TABLE refresh_tokens IS '30-day rolling refresh tokens. Stored as SHA-256 hash — raw value sent to client in HttpOnly cookie only.';

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_active     ON refresh_tokens(expires_at)
    WHERE revoked_at IS NULL;

-- ============================================================
-- SECTION 2: FLEET STRUCTURE
-- ============================================================

CREATE TABLE IF NOT EXISTS amoebas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    is_central  BOOLEAN NOT NULL DEFAULT FALSE,
    status      TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES users(id)
);

-- Only one central amoeba is allowed company-wide
CREATE UNIQUE INDEX idx_amoebas_one_central ON amoebas(is_central)
    WHERE is_central = TRUE;

COMMENT ON TABLE  amoebas IS 'Organisational unit. Groups operators and supervisors under shared P&L. Not a single location — may span multiple AmoebaSites.';
COMMENT ON COLUMN amoebas.is_central IS 'The Central amoeba carries company-wide overhead (HQ rent, management salaries, etc.) and has no operators. Its costs are distributed proportionally to operational amoebas at report time.';

-- ------------------------------------
-- Physical locations within an amoeba
-- ------------------------------------
CREATE TABLE IF NOT EXISTS amoeba_sites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amoeba_id       UUID NOT NULL REFERENCES amoebas(id),
    name            TEXT NOT NULL,          -- e.g. "Lekki Garage", "VI Drop-off"
    gps_lat         DOUBLE PRECISION,
    gps_lng         DOUBLE PRECISION,
    alert_radius_m  INTEGER NOT NULL DEFAULT 2000,  -- radius for location-based alerts
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one primary site per amoeba
CREATE UNIQUE INDEX idx_amoeba_sites_one_primary ON amoeba_sites(amoeba_id)
    WHERE is_primary = TRUE;

COMMENT ON TABLE  amoeba_sites IS 'Physical sub-location within an amoeba. Every operator must be assigned to a specific site. GPS centroid and radius used for far_from_amoeba and vehicle_not_returned alerts.';

CREATE INDEX idx_amoeba_sites_amoeba_id ON amoeba_sites(amoeba_id);

-- ------------------------------------
-- Fleet vehicles
-- ------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amoeba_id               UUID NOT NULL REFERENCES amoebas(id),
    plate                   TEXT NOT NULL UNIQUE,
    vehicle_type            TEXT NOT NULL
                                CHECK (vehicle_type IN ('car', 'motorbike', 'van')),
    make_model              TEXT,
    year                    SMALLINT,
    color                   TEXT,
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'inactive', 'in_repair')),
    assigned_operator_id    UUID,   -- FK added post-operators table creation (circular ref)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              UUID REFERENCES users(id)
);

CREATE INDEX idx_vehicles_amoeba_id ON vehicles(amoeba_id);
CREATE INDEX idx_vehicles_status    ON vehicles(status);

-- ============================================================
-- SECTION 3: OPERATORS
-- ============================================================

CREATE TABLE IF NOT EXISTS operators (
    user_id                     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    amoeba_id                   UUID NOT NULL REFERENCES amoebas(id),
    site_id                     UUID NOT NULL REFERENCES amoeba_sites(id),
    supervisor_id               UUID REFERENCES users(id),
    vehicle_id                  UUID REFERENCES vehicles(id),
    daily_revenue_target        NUMERIC(12, 2),
    -- Monnify reserved account — provisioned automatically by Monnify Service
    -- after Ops App fires operator.activated webhook event
    monnify_reserved_account    TEXT UNIQUE,
    monnify_account_ref         TEXT,
    operator_status             TEXT NOT NULL DEFAULT 'pending_activation'
                                    CHECK (operator_status IN (
                                        'pending_activation', 'active',
                                        'inactive', 'suspended'
                                    )),
    activated_at                TIMESTAMPTZ,
    deactivated_at              TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  operators IS 'Extends users for operator-specific fields. 1:1 with users where role = operator. Platform registrations are in operator_platform_accounts.';
COMMENT ON COLUMN operators.daily_revenue_target IS 'Single combined NGN target across all platforms. Not per-platform.';
COMMENT ON COLUMN operators.monnify_reserved_account IS 'Populated via PATCH /api/v1/operators/:id/monnify-account callback from Monnify Service. Not set by Ops App directly.';

CREATE INDEX idx_operators_amoeba_id     ON operators(amoeba_id);
CREATE INDEX idx_operators_site_id       ON operators(site_id);
CREATE INDEX idx_operators_supervisor_id ON operators(supervisor_id);
CREATE INDEX idx_operators_vehicle_id    ON operators(vehicle_id)
    WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_operators_status        ON operators(operator_status);
CREATE INDEX idx_operators_monnify       ON operators(monnify_reserved_account)
    WHERE monnify_reserved_account IS NOT NULL;

-- Now close the circular FK: vehicles.assigned_operator_id → operators
ALTER TABLE vehicles
    ADD CONSTRAINT fk_vehicles_assigned_operator
    FOREIGN KEY (assigned_operator_id) REFERENCES operators(user_id)
    ON DELETE SET NULL;

CREATE INDEX idx_vehicles_assigned_operator ON vehicles(assigned_operator_id)
    WHERE assigned_operator_id IS NOT NULL;

-- ============================================================
-- SECTION 4: PLATFORM ACCOUNTS & REGISTRATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform            TEXT NOT NULL
                            CHECK (platform IN ('bolt', 'uber', 'indrive', 'other')),
    display_name        TEXT NOT NULL,          -- e.g. "Uber Cars – Acct 1"
    vehicle_type        TEXT NOT NULL DEFAULT 'any'
                            CHECK (vehicle_type IN ('car', 'motorbike', 'any')),
    account_subtype     TEXT NOT NULL DEFAULT 'general'
                            CHECK (account_subtype IN ('ride_hailing', 'courier', 'general')),
    credentials_key     TEXT NOT NULL,          -- env var prefix for connector credentials
    -- Platform-specific identifiers (nullable — only set for relevant platform)
    bolt_company_id     TEXT,
    uber_org_id         TEXT,                   -- encrypted org ID (for reports/actions)
    uber_org_uuid       TEXT,                   -- plain UUID (for timeline/live-location)
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID REFERENCES users(id)
);

COMMENT ON TABLE  platform_accounts IS 'One row per platform data source. Supports multiple accounts per platform (e.g. two Uber accounts). Adding a new account requires only a new row + credentials — no code change.';
COMMENT ON COLUMN platform_accounts.credentials_key IS 'References the env var prefix or secrets-vault key where connector credentials are stored. E.g. "UBER_CARS_ACCT1" → looks for UBER_CARS_ACCT1_CLIENT_ID, etc.';

CREATE INDEX idx_platform_accounts_platform ON platform_accounts(platform);
CREATE INDEX idx_platform_accounts_active   ON platform_accounts(is_active);

-- ------------------------------------
-- Operator ↔ Platform Account registrations
-- ------------------------------------
CREATE TABLE IF NOT EXISTS operator_platform_accounts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id             UUID NOT NULL REFERENCES operators(user_id) ON DELETE CASCADE,
    platform_account_id     UUID NOT NULL REFERENCES platform_accounts(id),
    platform_operator_id    TEXT NOT NULL,  -- driver ID assigned by the platform
    registration_status     TEXT NOT NULL DEFAULT 'registered'
                                CHECK (registration_status IN (
                                    'registered', 'active', 'inactive', 'suspended'
                                )),
    activated_at            TIMESTAMPTZ,
    deactivated_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (operator_id, platform_account_id)
);

COMMENT ON TABLE  operator_platform_accounts IS 'One row per (operator, platform account) registration. An operator may be on Bolt + both Uber accounts. Alert engine queries rows where registration_status = active.';

CREATE INDEX idx_opa_operator_id          ON operator_platform_accounts(operator_id);
CREATE INDEX idx_opa_platform_account_id  ON operator_platform_accounts(platform_account_id);
CREATE INDEX idx_opa_status               ON operator_platform_accounts(registration_status);
-- For connector lookups: find operator from platform's own driver ID
CREATE INDEX idx_opa_platform_driver_id   ON operator_platform_accounts(platform_account_id, platform_operator_id);

-- ============================================================
-- SECTION 5: DAILY PERFORMANCE RECORDS
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_daily_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id             UUID NOT NULL REFERENCES operators(user_id),
    platform_account_id     UUID NOT NULL REFERENCES platform_accounts(id),
    record_date             DATE NOT NULL,      -- Lagos calendar date (WAT)

    -- Trip counts
    trips_total             INTEGER     NOT NULL DEFAULT 0,
    trips_completed         INTEGER     NOT NULL DEFAULT 0,
    trips_cancelled         INTEGER     NOT NULL DEFAULT 0,
    trips_no_response       INTEGER     NOT NULL DEFAULT 0,
    trips_rejected          INTEGER     NOT NULL DEFAULT 0,

    -- Revenue (NGN)
    ride_revenue_ngn        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_earnings_ngn        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    booking_fees_ngn        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tips_ngn                NUMERIC(12, 2) NOT NULL DEFAULT 0,

    -- Payment split
    cash_trips              INTEGER     NOT NULL DEFAULT 0,
    card_trips              INTEGER     NOT NULL DEFAULT 0,
    cash_collected_ngn      NUMERIC(12, 2) NOT NULL DEFAULT 0,

    -- Performance ratios (0.00–100.00)
    acceptance_pct          NUMERIC(5, 2),
    cancellation_pct        NUMERIC(5, 2),
    completion_pct          NUMERIC(5, 2),

    -- Time (decimal hours)
    hours_online            NUMERIC(6, 2) NOT NULL DEFAULT 0,
    hours_offline           NUMERIC(6, 2) NOT NULL DEFAULT 0,

    -- Computed Performance Score components (stored for efficient reporting)
    -- All normalised 0–100; weights configurable via performance_score_config
    acceptance_score        NUMERIC(5, 2),
    time_online_score       NUMERIC(5, 2),
    cash_receipt_score      NUMERIC(5, 2),
    revenue_score           NUMERIC(5, 2),
    performance_score       NUMERIC(5, 2),  -- final weighted score

    -- Ingestion metadata
    source                  TEXT NOT NULL DEFAULT 'live'
                                CHECK (source IN ('live', 'migration', 'manual_correction')),
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_payload             JSONB,          -- full API response for reprocessing

    UNIQUE (operator_id, platform_account_id, record_date)
);

COMMENT ON TABLE  platform_daily_records IS 'One row per operator per platform account per day. Ingested hourly by IngestModule. Scores are computed post-ingest and stored here for fast leaderboard queries.';
COMMENT ON COLUMN platform_daily_records.performance_score IS 'Weighted score = W_acceptance×acceptance_score + W_online×time_online_score + W_cash×cash_receipt_score + W_revenue×revenue_score. Weights sourced from performance_score_config.';
COMMENT ON COLUMN platform_daily_records.cash_receipt_score IS 'max(0, 100 × (1 − shortfall_ngn / max(expected_cash_ngn, 1))). Expected cash = cash_collected_ngn portion of ride_revenue_ngn vs cash paid into Monnify that day.';

CREATE INDEX idx_pdr_operator_date          ON platform_daily_records(operator_id, record_date DESC);
CREATE INDEX idx_pdr_platform_account_date  ON platform_daily_records(platform_account_id, record_date DESC);
CREATE INDEX idx_pdr_date                   ON platform_daily_records(record_date DESC);
CREATE INDEX idx_pdr_source                 ON platform_daily_records(source);
-- Leaderboard queries — performance score descending for a given date range
CREATE INDEX idx_pdr_score                  ON platform_daily_records(record_date DESC, performance_score DESC NULLS LAST);

-- ============================================================
-- SECTION 6: SHIFT EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id         UUID NOT NULL REFERENCES operators(user_id),
    event_type          TEXT NOT NULL
                            CHECK (event_type IN (
                                'check_in', 'check_out',
                                'platform_online', 'platform_offline'
                            )),
    platform_account_id UUID REFERENCES platform_accounts(id),  -- NULL for app check-in/out
    occurred_at         TIMESTAMPTZ NOT NULL,
    shift_date          DATE NOT NULL,      -- Lagos calendar date
    gps_lat             DOUBLE PRECISION,
    gps_lng             DOUBLE PRECISION,
    source              TEXT NOT NULL DEFAULT 'app'
                            CHECK (source IN ('app', 'platform_api')),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  shift_events IS 'Immutable log of shift state transitions per operator. App check-in/out (source=app) and platform online/offline events (source=platform_api) are both stored here.';

CREATE INDEX idx_shift_events_operator_date ON shift_events(operator_id, shift_date DESC);
CREATE INDEX idx_shift_events_occurred_at   ON shift_events(occurred_at DESC);
CREATE INDEX idx_shift_events_type          ON shift_events(event_type);

-- ============================================================
-- SECTION 7: ALERTS
-- ============================================================

CREATE TABLE IF NOT EXISTS alerts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id         UUID NOT NULL REFERENCES operators(user_id),
    platform_account_id UUID REFERENCES platform_accounts(id),
    alert_type          TEXT NOT NULL
                            CHECK (alert_type IN (
                                'late_resumption',
                                'far_from_amoeba',
                                'not_seen_today',
                                'currently_offline',
                                'excess_offline',
                                'high_wait_ratio',
                                'trip_rejection',
                                'vehicle_not_returned',
                                'below_target_midday'
                            )),
    alert_date          DATE NOT NULL,      -- Lagos calendar date
    tier                SMALLINT NOT NULL DEFAULT 0,    -- 0 = single-tier; 1/2/3 = escalating
    episode_key         TEXT,               -- dedup key for recurring-event alerts (currently_offline, trip_rejection)

    fired_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Resolution workflow
    resolution_status   TEXT NOT NULL DEFAULT 'open'
                            CHECK (resolution_status IN (
                                'open', 'acknowledged', 'resolved',
                                'snoozed', 'escalated', 'auto_closed'
                            )),
    acknowledged_at     TIMESTAMPTZ,
    acknowledged_by     UUID REFERENCES users(id),
    escalated_at        TIMESTAMPTZ,
    escalated_to        UUID REFERENCES users(id),
    snoozed_until       TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    resolved_by         UUID REFERENCES users(id),
    resolution_notes    TEXT,

    -- Notification dispatch
    sms_sent            BOOLEAN NOT NULL DEFAULT FALSE,
    email_sent          BOOLEAN NOT NULL DEFAULT FALSE,
    push_sent           BOOLEAN NOT NULL DEFAULT FALSE,
    sms_skip_reason     TEXT,               -- e.g. 'disabled_by_toggle', 'no_phone', 'suppressed'

    metadata            JSONB               -- alert-type-specific payload (offline_minutes, gps coords, order_id, etc.)
);

-- Deduplication constraint. episode_key may be NULL (single-episode alerts).
-- PostgreSQL UNIQUE treats NULL as distinct, so use a unique index with COALESCE.
CREATE UNIQUE INDEX idx_alerts_dedup ON alerts(
    operator_id,
    alert_type,
    alert_date,
    COALESCE(episode_key, ''),
    tier
);

COMMENT ON TABLE  alerts IS 'One row per alert event. Dedup is enforced by idx_alerts_dedup — a second engine run will skip any (operator, type, date, episode_key, tier) already recorded. Tier 0 = non-escalating. Tiers 1/2/3 fire and dedup independently.';
COMMENT ON COLUMN alerts.episode_key IS 'For currently_offline: offline-period start timestamp. For trip_rejection: order_id. Allows multiple distinct episodes per day without cross-contamination.';
COMMENT ON COLUMN alerts.tier IS '0 for single-tier alerts. For excess_offline and high_wait_ratio: 1 (>90 min/>20%), 2 (>120 min/>30%), 3 (>150 min/>40%). Each tier deduplicates independently.';

CREATE INDEX idx_alerts_operator_date  ON alerts(operator_id, alert_date DESC);
CREATE INDEX idx_alerts_date_status    ON alerts(alert_date DESC, resolution_status);
CREATE INDEX idx_alerts_type           ON alerts(alert_type);
CREATE INDEX idx_alerts_fired_at       ON alerts(fired_at DESC);
-- Supervisor home screen: open alerts for all operators under supervisor
CREATE INDEX idx_alerts_open           ON alerts(operator_id, fired_at DESC)
    WHERE resolution_status = 'open';

-- ------------------------------------
-- Per-alert-type notification channel settings
-- (replaces alert_sms_settings from the existing system; extended to push + email)
-- ------------------------------------
CREATE TABLE IF NOT EXISTS alert_notification_settings (
    alert_type      TEXT PRIMARY KEY,
    sms_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID REFERENCES users(id)
);

COMMENT ON TABLE alert_notification_settings IS 'Per-alert-type kill switches for each notification channel. Seeded with all 9 alert types at migration time.';

INSERT INTO alert_notification_settings (alert_type) VALUES
    ('late_resumption'),
    ('far_from_amoeba'),
    ('not_seen_today'),
    ('currently_offline'),
    ('excess_offline'),
    ('high_wait_ratio'),
    ('trip_rejection'),
    ('vehicle_not_returned'),
    ('below_target_midday')
ON CONFLICT (alert_type) DO NOTHING;

-- ============================================================
-- SECTION 8: DEVIATION REASONS (operator excuses for alerts)
-- ============================================================

CREATE TABLE IF NOT EXISTS deviation_reasons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id            UUID NOT NULL REFERENCES alerts(id),
    operator_id         UUID NOT NULL REFERENCES operators(user_id),
    reason_code         TEXT NOT NULL
                            CHECK (reason_code IN (
                                'network', 'vehicle_fault', 'fuel',
                                'platform_blocked', 'personal_emergency', 'other'
                            )),
    free_text           TEXT,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    supervisor_review   TEXT NOT NULL DEFAULT 'pending'
                            CHECK (supervisor_review IN ('accepted', 'rejected', 'pending')),
    review_notes        TEXT,
    reviewed_at         TIMESTAMPTZ,
    reviewed_by         UUID REFERENCES users(id)
);

COMMENT ON TABLE deviation_reasons IS 'Operator-submitted reason for an alert (e.g. why they were offline). Supervisor accepts or rejects. Acceptance can influence the alert resolution workflow.';

CREATE INDEX idx_deviation_reasons_alert_id  ON deviation_reasons(alert_id);
CREATE INDEX idx_deviation_reasons_operator  ON deviation_reasons(operator_id, submitted_at DESC);
CREATE INDEX idx_deviation_reasons_review    ON deviation_reasons(supervisor_review);

-- ============================================================
-- SECTION 9: INCIDENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id     UUID NOT NULL REFERENCES operators(user_id),
    incident_type   TEXT NOT NULL
                        CHECK (incident_type IN (
                            'accident', 'breakdown', 'police',
                            'petrol', 'low_battery', 'other'
                        )),
    status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN (
                            'open', 'acknowledged', 'in_progress', 'resolved', 'closed'
                        )),
    severity        TEXT NOT NULL DEFAULT 'medium'
                        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    incident_date   DATE NOT NULL,      -- Lagos calendar date
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gps_lat         DOUBLE PRECISION,
    gps_lng         DOUBLE PRECISION,
    operator_notes  TEXT,

    -- Supervisor handling
    acknowledged_at     TIMESTAMPTZ,
    acknowledged_by     UUID REFERENCES users(id),
    supervisor_notes    TEXT,

    -- Resolution
    resolved_at         TIMESTAMPTZ,
    resolved_by         UUID REFERENCES users(id),
    resolution_summary  TEXT,

    media_ids           UUID[],     -- array of media_items.id

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE incidents IS 'Operator-reported field incidents (accident, breakdown, police stop, etc.). Supervisor sees live alert and can attach notes. Media captured at time of incident.';

CREATE INDEX idx_incidents_operator_date  ON incidents(operator_id, incident_date DESC);
CREATE INDEX idx_incidents_status         ON incidents(status);
CREATE INDEX idx_incidents_submitted_at   ON incidents(submitted_at DESC);

-- ============================================================
-- SECTION 10: VEHICLE INSPECTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS inspections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID NOT NULL REFERENCES vehicles(id),
    operator_id     UUID REFERENCES operators(user_id),     -- operator at time of inspection
    inspector_id    UUID NOT NULL REFERENCES users(id),     -- supervisor conducting inspection
    inspection_date DATE NOT NULL,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gps_lat         DOUBLE PRECISION,
    gps_lng         DOUBLE PRECISION,

    -- Readings
    odometer_km     NUMERIC(8, 1),
    fuel_level_pct  SMALLINT CHECK (fuel_level_pct BETWEEN 0 AND 100),

    -- Overall condition
    condition       TEXT NOT NULL
                        CHECK (condition IN ('ok', 'minor_issues', 'needs_repair', 'unsafe')),
    issues_description TEXT,

    -- Structured checklist (flexible schema — items vary by vehicle_type)
    -- Example: {"tyres": "ok", "brakes": "ok", "lights": "fault", "wipers": "ok"}
    checklist       JSONB,

    media_ids       UUID[],

    -- Manager review
    review_status   TEXT NOT NULL DEFAULT 'pending'
                        CHECK (review_status IN ('pending', 'approved', 'flagged')),
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     UUID REFERENCES users(id),
    review_notes    TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE inspections IS 'Supervisor pre-/post-shift vehicle inspection. GPS + camera-only media mandatory. Manager reviews flagged inspections.';

CREATE INDEX idx_inspections_vehicle       ON inspections(vehicle_id, inspection_date DESC);
CREATE INDEX idx_inspections_inspector     ON inspections(inspector_id, submitted_at DESC);
CREATE INDEX idx_inspections_date          ON inspections(inspection_date DESC);
CREATE INDEX idx_inspections_review_status ON inspections(review_status);

-- ============================================================
-- SECTION 11: MEDIA ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS media_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id         UUID NOT NULL REFERENCES users(id),

    context_type        TEXT NOT NULL
                            CHECK (context_type IN (
                                'inspection', 'incident', 'odometer', 'fuel',
                                'damage', 'cash_receipt', 'return_confirmation', 'other'
                            )),
    context_id          UUID NOT NULL,      -- polymorphic ref: no FK enforced at DB level

    -- Capture provenance
    captured_at         TIMESTAMPTZ NOT NULL,   -- from EXIF DateTimeOriginal
    server_received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gps_lat             DOUBLE PRECISION,
    gps_lng             DOUBLE PRECISION,
    exif_validated      BOOLEAN NOT NULL DEFAULT FALSE,  -- passed ±5 min EXIF time check

    -- Object storage
    file_key            TEXT NOT NULL UNIQUE,
    storage_bucket      TEXT NOT NULL DEFAULT 'ops-media',
    mime_type           TEXT NOT NULL,
    file_size_bytes     BIGINT,
    width_px            INTEGER,
    height_px           INTEGER,
    duration_seconds    SMALLINT,               -- video only

    -- Compressed preview (for low-bandwidth thumbnail display)
    thumbnail_key       TEXT,

    -- TUS resumable upload tracking
    tus_upload_id       TEXT UNIQUE,
    upload_offset       BIGINT NOT NULL DEFAULT 0,

    upload_status       TEXT NOT NULL DEFAULT 'pending'
                            CHECK (upload_status IN (
                                'pending', 'processing', 'stored', 'failed'
                            )),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  media_items IS 'One row per photo/video. All media is camera-captured (capture="environment"). EXIF timestamp validated within 5 min of server receipt. Uploaded via TUS protocol (resumable). context_id is a polymorphic UUID — no DB-level FK.';
COMMENT ON COLUMN media_items.tus_upload_id IS 'TUS upload resource ID. Client uses this to resume interrupted uploads. Cleared on successful storage.';

CREATE INDEX idx_media_items_context      ON media_items(context_type, context_id);
CREATE INDEX idx_media_items_uploader     ON media_items(uploader_id);
CREATE INDEX idx_media_items_upload_status ON media_items(upload_status);
CREATE INDEX idx_media_items_captured_at  ON media_items(captured_at DESC);

-- ============================================================
-- SECTION 12: CASH TRANSACTIONS (ingested from Monnify Service)
-- ============================================================

CREATE TABLE IF NOT EXISTS cash_transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id             UUID NOT NULL REFERENCES operators(user_id),

    amount_ngn              NUMERIC(12, 2) NOT NULL,
    transaction_ref         TEXT NOT NULL UNIQUE,   -- Monnify transaction reference
    paid_at                 TIMESTAMPTZ NOT NULL,
    transaction_date        DATE NOT NULL,          -- Lagos calendar date

    -- Monnify metadata
    monnify_account_ref     TEXT,
    payment_method          TEXT,   -- bank_transfer, ussd, card, nqr, etc.
    narration               TEXT,
    raw_payload             JSONB,

    -- Reconciliation with platform daily record
    reconciliation_status   TEXT NOT NULL DEFAULT 'unmatched'
                                CHECK (reconciliation_status IN (
                                    'unmatched', 'matched', 'excess', 'shortfall', 'disputed'
                                )),
    matched_record_id       UUID REFERENCES platform_daily_records(id),
    expected_amount_ngn     NUMERIC(12, 2),
    variance_ngn            NUMERIC(12, 2),     -- actual − expected (positive = excess)
    reconciled_at           TIMESTAMPTZ,
    reconciled_by           UUID REFERENCES users(id),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  cash_transactions IS 'Ingested via POST /api/v1/cash/transactions called by Monnify Service (HMAC-authenticated). operator_id resolved from monnify_reserved_account on the operators table.';

CREATE INDEX idx_cash_transactions_operator        ON cash_transactions(operator_id, transaction_date DESC);
CREATE INDEX idx_cash_transactions_date            ON cash_transactions(transaction_date DESC);
CREATE INDEX idx_cash_transactions_ref             ON cash_transactions(transaction_ref);
CREATE INDEX idx_cash_transactions_reconciliation  ON cash_transactions(reconciliation_status);

-- ============================================================
-- SECTION 13: AMOEBA DAILY SUMMARIES
-- ============================================================

CREATE TABLE IF NOT EXISTS amoeba_daily_summaries (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amoeba_id                   UUID NOT NULL REFERENCES amoebas(id),
    summary_date                DATE NOT NULL,

    -- Fleet
    active_operators            INTEGER NOT NULL DEFAULT 0,
    operators_checked_in        INTEGER NOT NULL DEFAULT 0,
    operators_no_show           INTEGER NOT NULL DEFAULT 0,

    -- Performance aggregates
    trips_total                 INTEGER NOT NULL DEFAULT 0,
    trips_completed             INTEGER NOT NULL DEFAULT 0,
    ride_revenue_ngn            NUMERIC(14, 2) NOT NULL DEFAULT 0,
    net_earnings_ngn            NUMERIC(14, 2) NOT NULL DEFAULT 0,
    avg_acceptance_pct          NUMERIC(5, 2),
    avg_completion_pct          NUMERIC(5, 2),
    total_hours_online          NUMERIC(8, 2) NOT NULL DEFAULT 0,
    target_hours                NUMERIC(8, 2) NOT NULL DEFAULT 0,
    efficiency_pct              NUMERIC(5, 2),

    -- Cash
    cash_remitted_ngn           NUMERIC(14, 2) NOT NULL DEFAULT 0,
    expected_cash_ngn           NUMERIC(14, 2) NOT NULL DEFAULT 0,
    cash_variance_ngn           NUMERIC(14, 2) NOT NULL DEFAULT 0,

    -- Financial
    target_revenue_ngn          NUMERIC(14, 2) NOT NULL DEFAULT 0,
    target_attainment_pct       NUMERIC(5, 2),
    own_fixed_costs_ngn         NUMERIC(14, 2) NOT NULL DEFAULT 0,  -- amoeba's own fixed costs
    central_allocation_ngn      NUMERIC(14, 2) NOT NULL DEFAULT 0,  -- share of Central amoeba costs
    total_costs_ngn             NUMERIC(14, 2) NOT NULL DEFAULT 0,
    profit_loss_ngn             NUMERIC(14, 2) NOT NULL DEFAULT 0,

    -- Daily report submission (deadline 19:00 WAT; manager alert on miss)
    daily_report_submitted      BOOLEAN NOT NULL DEFAULT FALSE,
    report_submitted_at         TIMESTAMPTZ,
    report_submitted_by         UUID REFERENCES users(id),
    report_notes                TEXT,

    computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (amoeba_id, summary_date)
);

COMMENT ON TABLE  amoeba_daily_summaries IS 'Pre-computed aggregate per amoeba per day. Recomputed on each ingest cycle and on demand. central_allocation_ngn is computed at report time from FixedCost and active operator headcount — not pre-stored permanently.';

CREATE INDEX idx_amoeba_daily_summaries_amoeba ON amoeba_daily_summaries(amoeba_id, summary_date DESC);
CREATE INDEX idx_amoeba_daily_summaries_date   ON amoeba_daily_summaries(summary_date DESC);

-- ============================================================
-- SECTION 14: FIXED COSTS
-- ============================================================

CREATE TABLE IF NOT EXISTS fixed_costs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amoeba_id       UUID NOT NULL REFERENCES amoebas(id),
    cost_category   TEXT NOT NULL
                        CHECK (cost_category IN (
                            'rent', 'vehicle_parking', 'salaries',
                            'electricity', 'communication',
                            'maintenance_budget', 'other'
                        )),
    cost_label      TEXT,   -- free-text detail; REQUIRED when cost_category = 'other'
    amount_ngn      NUMERIC(12, 2) NOT NULL CHECK (amount_ngn >= 0),
    month           CHAR(7) NOT NULL,   -- 'YYYY-MM'
    entered_by      UUID NOT NULL REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fixed_costs_other_label CHECK (
        cost_category != 'other' OR (cost_label IS NOT NULL AND TRIM(cost_label) != '')
    )
);

COMMENT ON TABLE  fixed_costs IS 'Admin/manager-entered cost items per amoeba per calendar month. Central amoeba costs are distributed to operational amoebas proportionally by active operator headcount at report-generation time.';
COMMENT ON COLUMN fixed_costs.month IS 'Calendar month in YYYY-MM format. Costs are reviewed and updated monthly.';

CREATE INDEX idx_fixed_costs_amoeba_month ON fixed_costs(amoeba_id, month DESC);
CREATE INDEX idx_fixed_costs_month        ON fixed_costs(month DESC);

-- ============================================================
-- SECTION 15: PERFORMANCE SCORE CONFIGURATION
-- ============================================================

CREATE TABLE IF NOT EXISTS performance_score_config (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Weights must sum to exactly 1.00
    w_acceptance        NUMERIC(4, 2) NOT NULL DEFAULT 0.30,
    w_time_online       NUMERIC(4, 2) NOT NULL DEFAULT 0.30,
    w_cash_receipt      NUMERIC(4, 2) NOT NULL DEFAULT 0.30,
    w_revenue           NUMERIC(4, 2) NOT NULL DEFAULT 0.10,
    -- Normalisation parameters
    online_hours_target NUMERIC(4, 1) NOT NULL DEFAULT 10.0, -- hours online = 100 on time_online_score
    effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
    notes               TEXT,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT psc_weights_sum CHECK (
        ROUND(w_acceptance + w_time_online + w_cash_receipt + w_revenue, 2) = 1.00
    )
);

COMMENT ON TABLE  performance_score_config IS 'Versioned configuration for the Performance Score formula weights. Query: SELECT * FROM performance_score_config WHERE effective_from <= CURRENT_DATE ORDER BY effective_from DESC LIMIT 1. Revenue component is always calculated but hidden from operator-role API responses.';

CREATE INDEX idx_psc_effective_from ON performance_score_config(effective_from DESC);

-- ============================================================
-- SECTION 16: ALERTS ENGINE RUN LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_run_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_date            DATE NOT NULL,      -- Lagos calendar date
    run_hour            SMALLINT NOT NULL CHECK (run_hour BETWEEN 0 AND 23),
    operators_checked   INTEGER,
    alerts_fired        INTEGER,
    alerts_new          INTEGER,            -- net new (after dedup)
    duration_ms         INTEGER,
    errors              JSONB,              -- [{operator_id, alert_type, error_message}]
    status              TEXT NOT NULL DEFAULT 'completed'
                            CHECK (status IN ('running', 'completed', 'failed'))
);

COMMENT ON TABLE alert_run_logs IS 'One row per alert engine execution (hourly cron 07:00–21:00 WAT). Mirrors alert_run_log from the existing Replit system.';

CREATE INDEX idx_alert_run_logs_run_at   ON alert_run_logs(run_at DESC);
CREATE INDEX idx_alert_run_logs_run_date ON alert_run_logs(run_date DESC);

-- ============================================================
-- SECTION 17: INGEST RUN LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS ingest_run_logs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_account_id     UUID NOT NULL REFERENCES platform_accounts(id),
    run_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_date                DATE NOT NULL,
    operators_fetched       INTEGER,
    records_upserted        INTEGER,
    records_failed          INTEGER,
    duration_ms             INTEGER,
    errors                  JSONB,
    status                  TEXT NOT NULL DEFAULT 'completed'
                                CHECK (status IN ('running', 'completed', 'partial', 'failed'))
);

CREATE INDEX idx_ingest_run_logs_platform  ON ingest_run_logs(platform_account_id, run_at DESC);
CREATE INDEX idx_ingest_run_logs_run_date  ON ingest_run_logs(run_date DESC);

-- ============================================================
-- SECTION 18: NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_logs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id            UUID NOT NULL REFERENCES users(id),
    channel                 TEXT NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
    template_key            TEXT NOT NULL,

    -- Source context
    source_type             TEXT CHECK (source_type IN ('alert', 'incident', 'system', 'announcement')),
    source_id               UUID,       -- references alerts.id, incidents.id, etc.

    -- Content snapshot (for audit — content may vary by template at send time)
    subject                 TEXT,
    body_preview            TEXT,       -- first 500 chars of rendered body

    -- Delivery
    status                  TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN (
                                    'pending', 'sent', 'delivered', 'failed', 'suppressed'
                                )),
    attempt_count           SMALLINT NOT NULL DEFAULT 0,
    last_attempted_at       TIMESTAMPTZ,
    delivered_at            TIMESTAMPTZ,
    error_message           TEXT,
    provider_message_id     TEXT,       -- Twilio SID, FCM message ID, Brevo message ID
    sent_at                 TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_logs_recipient ON notification_logs(recipient_id, created_at DESC);
CREATE INDEX idx_notification_logs_source    ON notification_logs(source_type, source_id)
    WHERE source_id IS NOT NULL;
CREATE INDEX idx_notification_logs_status    ON notification_logs(status, created_at DESC);
CREATE INDEX idx_notification_logs_channel   ON notification_logs(channel);

-- ============================================================
-- SECTION 19: ANNOUNCEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS announcements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    -- Audience targeting
    target_audience TEXT NOT NULL DEFAULT 'all'
                        CHECK (target_audience IN (
                            'all', 'operators', 'supervisors', 'managers',
                            'amoeba', 'specific_users'
                        )),
    target_amoeba_id UUID REFERENCES amoebas(id),
    target_user_ids  UUID[],
    requires_ack     BOOLEAN NOT NULL DEFAULT FALSE,
    published_at     TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_announcements_published ON announcements(published_at DESC)
    WHERE published_at IS NOT NULL;
CREATE INDEX idx_announcements_author    ON announcements(author_id);

CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (announcement_id, user_id)
);

CREATE INDEX idx_announcement_acks_announcement ON announcement_acknowledgements(announcement_id);
CREATE INDEX idx_announcement_acks_user         ON announcement_acknowledgements(user_id);

-- ============================================================
-- SECTION 20: AUDIT LOG (append-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID REFERENCES users(id),  -- NULL for system-generated actions
    actor_role      TEXT,
    actor_name      TEXT NOT NULL,  -- denormalised — user may be deleted later
    action          TEXT NOT NULL,  -- e.g. 'operator.created', 'alert.acknowledged', 'config.updated'
    entity_type     TEXT NOT NULL,  -- e.g. 'operator', 'alert', 'vehicle'
    entity_id       TEXT NOT NULL,  -- UUID or composite key as text
    before_state    JSONB,
    after_state     JSONB,
    ip_address      INET,
    user_agent      TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  audit_entries IS 'Append-only immutable audit log. NEVER UPDATE OR DELETE rows in this table. Application layer enforces write-only access. actor_name is denormalised in case the user record is later deactivated.';

CREATE INDEX idx_audit_entries_entity      ON audit_entries(entity_type, entity_id);
CREATE INDEX idx_audit_entries_actor       ON audit_entries(actor_id, occurred_at DESC)
    WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_entries_occurred_at ON audit_entries(occurred_at DESC);
CREATE INDEX idx_audit_entries_action      ON audit_entries(action);

-- ============================================================
-- SECTION 21: APPLICATION SETTINGS (global key-value config)
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    value_type      TEXT NOT NULL DEFAULT 'string'
                        CHECK (value_type IN ('string', 'integer', 'boolean', 'json')),
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID REFERENCES users(id)
);

COMMENT ON TABLE app_settings IS 'Global configuration key-value store. Used for runtime-tunable settings that do not warrant a dedicated table column. Examples: max_video_duration_seconds, media_exif_tolerance_minutes, alert_operating_window_start.';

-- Seed default settings
INSERT INTO app_settings (key, value, value_type, description) VALUES
    ('max_video_duration_seconds',      '60',     'integer', 'Maximum allowed video length for media uploads'),
    ('max_image_size_kb',               '1024',   'integer', 'Client-side image compression target in KB'),
    ('media_exif_tolerance_minutes',    '5',      'integer', 'Allowable difference between EXIF timestamp and server receipt time'),
    ('alert_window_start_hour_wat',     '7',      'integer', 'Earliest hour (WAT) at which the alert engine runs'),
    ('alert_window_end_hour_wat',       '21',     'integer', 'Latest hour (WAT) at which the alert engine runs (inclusive)'),
    ('daily_report_deadline_hour_wat',  '19',     'integer', 'Hour (WAT) after which the daily report is considered overdue'),
    ('daily_report_reminder_hour_wat',  '18',     'integer', 'Hour (WAT) at which reminder push fires if report not submitted'),
    ('offline_grace_period_minutes',    '15',     'integer', 'Minutes of inactivity before currently_offline alert fires'),
    ('excess_offline_t1_minutes',       '90',     'integer', 'Excess offline tier-1 threshold in minutes'),
    ('excess_offline_t2_minutes',       '120',    'integer', 'Excess offline tier-2 threshold in minutes'),
    ('excess_offline_t3_minutes',       '150',    'integer', 'Excess offline tier-3 threshold in minutes'),
    ('high_wait_ratio_t1_pct',          '20',     'integer', 'High wait ratio tier-1 threshold as percentage'),
    ('high_wait_ratio_t2_pct',          '30',     'integer', 'High wait ratio tier-2 threshold as percentage'),
    ('high_wait_ratio_t3_pct',          '40',     'integer', 'High wait ratio tier-3 threshold as percentage'),
    ('vehicle_return_radius_km',        '10',     'integer', 'Max km from amoeba site for vehicle_not_returned alert'),
    ('midday_revenue_check_hour_wat',   '14',     'integer', 'Hour (WAT) for below_target_midday alert evaluation'),
    ('midday_revenue_threshold_pct',    '50',     'integer', 'Daily target % that triggers below_target_midday alert'),
    ('late_resumption_cutoff_hour_wat', '8',      'integer', 'Hour (WAT) after which first online event triggers late_resumption'),
    ('late_resumption_cutoff_minute',   '30',     'integer', 'Minute within the cutoff hour for late_resumption'),
    ('not_seen_cutoff_hour_wat',        '11',     'integer', 'Hour (WAT) after which no online activity triggers not_seen_today')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TRIGGERS: auto-update updated_at timestamps
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$ DECLARE tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'users', 'amoebas', 'amoeba_sites', 'vehicles',
        'operators', 'platform_accounts', 'operator_platform_accounts',
        'incidents', 'inspections', 'fixed_costs', 'announcements', 'app_settings'
    ])
    LOOP
        EXECUTE format('
            CREATE TRIGGER trg_%s_updated_at
                BEFORE UPDATE ON %I
                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        ', tbl, tbl);
    END LOOP;
END $$;

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Active operators with their amoeba, site, supervisor, and vehicle in one query
CREATE OR REPLACE VIEW v_active_operators AS
SELECT
    o.user_id,
    u.name,
    u.phone,
    o.operator_status,
    a.name                  AS amoeba_name,
    a.is_central,
    s.name                  AS site_name,
    s.gps_lat               AS site_lat,
    s.gps_lng               AS site_lng,
    s.alert_radius_m,
    sup.name                AS supervisor_name,
    v.plate                 AS vehicle_plate,
    v.vehicle_type,
    o.daily_revenue_target,
    o.monnify_reserved_account
FROM operators o
JOIN users u     ON u.id = o.user_id
JOIN amoebas a   ON a.id = o.amoeba_id
JOIN amoeba_sites s ON s.id = o.site_id
LEFT JOIN users sup  ON sup.id = o.supervisor_id
LEFT JOIN vehicles v ON v.id = o.vehicle_id
WHERE o.operator_status = 'active'
  AND u.status = 'active';

-- Today's open alerts enriched with operator and amoeba info
-- (Lagos "today" must be passed as a parameter from application layer)
CREATE OR REPLACE VIEW v_alerts_detail AS
SELECT
    al.id                   AS alert_id,
    al.alert_type,
    al.alert_date,
    al.tier,
    al.episode_key,
    al.resolution_status,
    al.fired_at,
    al.metadata,
    u.name                  AS operator_name,
    u.phone                 AS operator_phone,
    a.name                  AS amoeba_name,
    s.name                  AS site_name,
    pa.platform,
    pa.display_name         AS platform_display_name,
    al.sms_sent,
    al.push_sent,
    al.sms_skip_reason
FROM alerts al
JOIN operators o ON o.user_id = al.operator_id
JOIN users u     ON u.id = o.user_id
JOIN amoebas a   ON a.id = o.amoeba_id
JOIN amoeba_sites s ON s.id = o.site_id
LEFT JOIN platform_accounts pa ON pa.id = al.platform_account_id;

-- Per-operator platform registrations (active only)
CREATE OR REPLACE VIEW v_active_operator_platforms AS
SELECT
    opa.operator_id,
    opa.platform_account_id,
    opa.platform_operator_id,
    pa.platform,
    pa.display_name,
    pa.vehicle_type,
    pa.account_subtype,
    pa.credentials_key
FROM operator_platform_accounts opa
JOIN platform_accounts pa ON pa.id = opa.platform_account_id
WHERE opa.registration_status = 'active'
  AND pa.is_active = TRUE;

-- ============================================================
-- END OF SCHEMA
-- ============================================================
-- Table count: 24 tables, 3 views
-- Sections:
--   1. users, user_devices, refresh_tokens
--   2. amoebas, amoeba_sites, vehicles
--   3. operators
--   4. platform_accounts, operator_platform_accounts
--   5. platform_daily_records
--   6. shift_events
--   7. alerts, alert_notification_settings
--   8. deviation_reasons
--   9. incidents
--  10. inspections
--  11. media_items
--  12. cash_transactions
--  13. amoeba_daily_summaries
--  14. fixed_costs
--  15. performance_score_config
--  16. alert_run_logs
--  17. ingest_run_logs
--  18. notification_logs
--  19. announcements, announcement_acknowledgements
--  20. audit_entries
--  21. app_settings
-- ============================================================
