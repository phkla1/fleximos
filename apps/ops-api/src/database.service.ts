import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PGlite } from "@electric-sql/pglite";
import { scheduledJobs } from "./scheduled-jobs.js";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly db = new PGlite(`file://${process.env.FLEXI_OPS_DB_DIR || ".data/ops-pglite"}`);

  async onModuleInit() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ops_operators (
        operator_id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL UNIQUE,
        operator_type TEXT NOT NULL,
        operator_status TEXT NOT NULL DEFAULT 'pending_activation',
        amoeba_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        supervisor_person_id TEXT,
        vehicle_id TEXT,
        monnify_reserved_account TEXT UNIQUE,
        daily_revenue_target_ngn NUMERIC(12, 2),
        activated_at TIMESTAMPTZ,
        deactivated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      ALTER TABLE ops_operators
        ADD COLUMN IF NOT EXISTS monnify_reserved_account TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_operator_monnify_account
        ON ops_operators(monnify_reserved_account)
        WHERE monnify_reserved_account IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ops_cash_transactions (
        cash_transaction_id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL REFERENCES ops_operators(operator_id),
        amount_ngn NUMERIC(12, 2) NOT NULL,
        transaction_ref TEXT NOT NULL UNIQUE,
        paid_at TIMESTAMPTZ NOT NULL,
        monnify_account_number TEXT NOT NULL,
        reconciliation_status TEXT NOT NULL DEFAULT 'matched',
        provider_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ops_cash_operator_paid
        ON ops_cash_transactions(operator_id, paid_at DESC);

      CREATE TABLE IF NOT EXISTS ops_cash_adjustments (
        cash_adjustment_id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL REFERENCES ops_operators(operator_id),
        adjustment_date DATE NOT NULL,
        amount_ngn NUMERIC(12, 2) NOT NULL,
        adjustment_type TEXT NOT NULL,
        reason TEXT NOT NULL,
        related_transaction_ref TEXT,
        notes TEXT,
        created_by_person_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ops_cash_adjustments_operator_date
        ON ops_cash_adjustments(operator_id, adjustment_date DESC);

      ALTER TABLE ops_cash_adjustments
        ADD COLUMN IF NOT EXISTS evidence_reference TEXT;

      CREATE TABLE IF NOT EXISTS ops_daily_closeouts (
        closeout_id TEXT PRIMARY KEY,
        record_date DATE NOT NULL,
        amoeba_id TEXT NOT NULL,
        supervisor_person_id TEXT NOT NULL,
        status TEXT NOT NULL,
        unresolved_alert_count INTEGER NOT NULL DEFAULT 0,
        cash_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        notes TEXT,
        submitted_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(record_date, amoeba_id, supervisor_person_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ops_daily_closeouts_date
        ON ops_daily_closeouts(record_date DESC, amoeba_id);

      CREATE TABLE IF NOT EXISTS ops_vehicles (
        vehicle_id TEXT PRIMARY KEY,
        plate TEXT NOT NULL UNIQUE,
        vehicle_type TEXT NOT NULL,
        amoeba_id TEXT NOT NULL,
        make_model TEXT,
        color TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        assigned_operator_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_platform_accounts (
        platform_account_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        display_name TEXT NOT NULL,
        vehicle_type TEXT NOT NULL,
        account_subtype TEXT NOT NULL,
        credentials_key TEXT NOT NULL,
        external_account_id TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_operator_platform_accounts (
        registration_id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL REFERENCES ops_operators(operator_id) ON DELETE CASCADE,
        platform_account_id TEXT NOT NULL REFERENCES ops_platform_accounts(platform_account_id),
        platform_operator_id TEXT NOT NULL,
        registration_status TEXT NOT NULL DEFAULT 'registered',
        activated_at TIMESTAMPTZ,
        deactivated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (operator_id, platform_account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ops_registration_platform_driver
        ON ops_operator_platform_accounts(platform_account_id, platform_operator_id);

      CREATE TABLE IF NOT EXISTS ops_ingestion_runs (
        ingestion_run_id TEXT PRIMARY KEY,
        platform_account_id TEXT NOT NULL REFERENCES ops_platform_accounts(platform_account_id),
        record_date DATE NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        records_received INTEGER NOT NULL DEFAULT 0,
        records_upserted INTEGER NOT NULL DEFAULT 0,
        records_rejected INTEGER NOT NULL DEFAULT 0,
        errors JSONB NOT NULL DEFAULT '[]'::jsonb,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        requested_by_person_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_ops_ingestion_runs_date
        ON ops_ingestion_runs(record_date DESC, started_at DESC);

      CREATE TABLE IF NOT EXISTS ops_platform_daily_records (
        daily_record_id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL REFERENCES ops_operators(operator_id),
        platform_account_id TEXT NOT NULL REFERENCES ops_platform_accounts(platform_account_id),
        ingestion_run_id TEXT REFERENCES ops_ingestion_runs(ingestion_run_id),
        record_date DATE NOT NULL,
        trips_total INTEGER NOT NULL DEFAULT 0,
        trips_completed INTEGER NOT NULL DEFAULT 0,
        trips_cancelled INTEGER NOT NULL DEFAULT 0,
        trips_no_response INTEGER NOT NULL DEFAULT 0,
        trips_rejected INTEGER NOT NULL DEFAULT 0,
        ride_revenue_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0,
        net_earnings_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0,
        booking_fees_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0,
        cash_trips INTEGER NOT NULL DEFAULT 0,
        card_trips INTEGER NOT NULL DEFAULT 0,
        acceptance_pct NUMERIC(5, 2),
        cancellation_pct NUMERIC(5, 2),
        completion_pct NUMERIC(5, 2),
        hours_online NUMERIC(6, 2) NOT NULL DEFAULT 0,
        last_seen_at TIMESTAMPTZ,
        current_status TEXT NOT NULL DEFAULT 'unknown',
        source TEXT NOT NULL DEFAULT 'live',
        data_quality TEXT NOT NULL DEFAULT 'authoritative',
        provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
        raw_payload JSONB,
        ingested_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (operator_id, platform_account_id, record_date)
      );

      CREATE INDEX IF NOT EXISTS idx_ops_daily_records_date
        ON ops_platform_daily_records(record_date DESC);
      CREATE INDEX IF NOT EXISTS idx_ops_daily_records_operator_date
        ON ops_platform_daily_records(operator_id, record_date DESC);

      ALTER TABLE ops_platform_daily_records
        ADD COLUMN IF NOT EXISTS official_distance_km NUMERIC(10, 2);

      CREATE TABLE IF NOT EXISTS ops_revenue_pace_profiles (
        pace_profile_id TEXT PRIMARY KEY,
        vehicle_type TEXT NOT NULL,
        day_type TEXT NOT NULL DEFAULT 'all',
        daily_target_ngn NUMERIC(12, 2) NOT NULL,
        checkpoints JSONB NOT NULL,
        warning_tolerance_pct NUMERIC(5, 2) NOT NULL DEFAULT 10,
        critical_tolerance_pct NUMERIC(5, 2) NOT NULL DEFAULT 20,
        effective_from DATE NOT NULL,
        effective_to DATE,
        created_by_person_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_vehicle_efficiency_policies (
        efficiency_policy_id TEXT PRIMARY KEY,
        vehicle_type TEXT NOT NULL,
        make_model TEXT,
        fuel_type TEXT NOT NULL DEFAULT 'petrol',
        standard_daily_fuel_quantity NUMERIC(10, 2) NOT NULL,
        fuel_unit TEXT NOT NULL DEFAULT 'litres',
        expected_distance_km NUMERIC(10, 2) NOT NULL,
        allowed_variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 10,
        effective_from DATE NOT NULL,
        effective_to DATE,
        created_by_person_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_economics_policies (
        economics_policy_id TEXT PRIMARY KEY,
        policy_name TEXT NOT NULL,
        admin_staff_daily_cost_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0,
        operator_labour_share_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
        daily_overhead_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0,
        expected_hours_per_operator NUMERIC(5, 2) NOT NULL DEFAULT 10,
        effective_from DATE NOT NULL,
        effective_to DATE,
        created_by_person_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_fuel_issues (
        fuel_issue_id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL REFERENCES ops_operators(operator_id),
        vehicle_id TEXT NOT NULL REFERENCES ops_vehicles(vehicle_id),
        operating_date DATE NOT NULL,
        quantity NUMERIC(10, 2) NOT NULL,
        unit TEXT NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL,
        confirmed_by_person_id TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(operator_id, vehicle_id, operating_date)
      );

      CREATE TABLE IF NOT EXISTS ops_tracker_daily_records (
        tracker_record_id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL REFERENCES ops_vehicles(vehicle_id),
        tracker_account_id TEXT,
        record_date DATE NOT NULL,
        actual_distance_km NUMERIC(10, 2) NOT NULL,
        data_quality TEXT NOT NULL DEFAULT 'authoritative',
        raw_payload JSONB,
        source TEXT NOT NULL DEFAULT 'live',
        ingested_at TIMESTAMPTZ NOT NULL,
        UNIQUE(vehicle_id, record_date)
      );

      CREATE TABLE IF NOT EXISTS ops_alerts (
        alert_id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL REFERENCES ops_operators(operator_id),
        platform_account_id TEXT REFERENCES ops_platform_accounts(platform_account_id),
        alert_type TEXT NOT NULL,
        alert_date DATE NOT NULL,
        tier INTEGER NOT NULL DEFAULT 0,
        episode_key TEXT,
        fired_at TIMESTAMPTZ NOT NULL,
        resolution_status TEXT NOT NULL DEFAULT 'open',
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by_person_id TEXT,
        resolved_at TIMESTAMPTZ,
        resolved_by_person_id TEXT,
        resolution_notes TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS ops_notification_deliveries (
        notification_delivery_id TEXT PRIMARY KEY,
        alert_id TEXT REFERENCES ops_alerts(alert_id),
        recipient_person_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt INTEGER NOT NULL DEFAULT 0,
        provider_message_id TEXT,
        error_summary TEXT,
        next_attempt_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        delivered_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(alert_id, recipient_person_id, channel)
      );

      CREATE INDEX IF NOT EXISTS idx_ops_notifications_status
        ON ops_notification_deliveries(status, next_attempt_at, created_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_alerts_dedup
        ON ops_alerts(operator_id, alert_type, alert_date, COALESCE(episode_key, ''), tier);

      CREATE TABLE IF NOT EXISTS ops_audit_entries (
        audit_id TEXT PRIMARY KEY,
        actor_person_id TEXT,
        actor_type TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_state JSONB,
        after_state JSONB,
        occurred_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_idempotency_records (
        idempotency_key TEXT PRIMARY KEY,
        status INTEGER NOT NULL,
        body JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_daily_report_snapshots (
        report_id TEXT PRIMARY KEY,
        record_date DATE NOT NULL,
        amoeba_id TEXT,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'generated',
        summary JSONB NOT NULL,
        rows JSONB NOT NULL,
        generated_by_person_id TEXT,
        generated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(record_date, amoeba_id, revision)
      );

      CREATE INDEX IF NOT EXISTS idx_ops_daily_reports_date
        ON ops_daily_report_snapshots(record_date DESC, generated_at DESC);

      CREATE TABLE IF NOT EXISTS ops_scheduled_jobs (
        job_name TEXT PRIMARY KEY,
        owning_module TEXT NOT NULL,
        trigger_mechanism TEXT NOT NULL,
        schedule_wat TEXT NOT NULL,
        queue_name TEXT NOT NULL,
        timeout_seconds INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        backoff_seconds INTEGER NOT NULL,
        idempotency_strategy TEXT NOT NULL,
        freshness_sla_minutes INTEGER NOT NULL,
        dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
        alert_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_finality TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_scheduled_job_runs (
        scheduled_job_run_id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL REFERENCES ops_scheduled_jobs(job_name),
        requested_window_start TIMESTAMPTZ,
        requested_window_end TIMESTAMPTZ,
        scheduler_trigger_id TEXT,
        queue_job_id TEXT,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        records_received INTEGER NOT NULL DEFAULT 0,
        records_upserted INTEGER NOT NULL DEFAULT 0,
        records_rejected INTEGER NOT NULL DEFAULT 0,
        requested_by_person_id TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        error_summary TEXT,
        next_retry_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ops_job_runs_name_created
        ON ops_scheduled_job_runs(job_name, created_at DESC);
    `);

    await this.seed();
    await this.seedScheduledJobs();
  }

  async onModuleDestroy() {
    await this.db.close();
  }

  async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.db.query<T>(sql, params);
    return result.rows[0] || null;
  }

  async many<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params);
    return result.rows;
  }

  async exec(sql: string, params: unknown[] = []) {
    return this.db.query(sql, params);
  }

  private async seed() {
    const existingAccount = await this.one("SELECT platform_account_id FROM ops_platform_accounts LIMIT 1");
    if (!existingAccount) {
      const timestamp = new Date().toISOString();
      const accounts = [
        ["platform_bolt_lagos", "bolt", "Bolt Lagos", "motorbike", "ride_hailing", "BOLT_LAGOS", "168098"],
        ["platform_uber_cars", "uber", "Uber Ride-Hailing", "car", "ride_hailing", "UBER_CARS", null],
        ["platform_uber_courier", "uber", "Uber Courier", "motorbike", "courier", "UBER_COURIER", null]
      ];
      for (const account of accounts) {
        await this.exec(
          `INSERT INTO ops_platform_accounts
            (platform_account_id, platform, display_name, vehicle_type, account_subtype, credentials_key,
             external_account_id, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $8)`,
          [...account, timestamp]
        );
      }
    }

    const existingPace = await this.one("SELECT pace_profile_id FROM ops_revenue_pace_profiles LIMIT 1");
    if (!existingPace) {
      const timestamp = new Date().toISOString();
      const checkpoints = [
        { time: "12:00", expected_pct: 40 },
        { time: "16:00", expected_pct: 65 },
        { time: "19:00", expected_pct: 90 },
        { time: "21:00", expected_pct: 100 }
      ];
      for (const [id, type, target] of [
        ["pace_car_default", "car", 60000],
        ["pace_motorbike_default", "motorbike", 27000]
      ]) {
        await this.exec(
          `INSERT INTO ops_revenue_pace_profiles
           (pace_profile_id, vehicle_type, day_type, daily_target_ngn, checkpoints,
            warning_tolerance_pct, critical_tolerance_pct, effective_from,
            created_by_person_id, created_at, updated_at)
           VALUES ($1,$2,'all',$3,$4,10,20,'2026-01-01','person_system',$5,$5)`,
          [id, type, target, checkpoints, timestamp]
        );
      }
    }

    const existingPolicy = await this.one("SELECT efficiency_policy_id FROM ops_vehicle_efficiency_policies LIMIT 1");
    if (!existingPolicy) {
      const timestamp = new Date().toISOString();
      for (const policy of [
        ["efficiency_car_default", "car", 15, 150],
        ["efficiency_motorbike_default", "motorbike", 5, 100]
      ]) {
        await this.exec(
          `INSERT INTO ops_vehicle_efficiency_policies
           (efficiency_policy_id, vehicle_type, fuel_type, standard_daily_fuel_quantity,
            fuel_unit, expected_distance_km, allowed_variance_pct, effective_from,
            created_by_person_id, created_at, updated_at)
           VALUES ($1,$2,'petrol',$3,'litres',$4,10,'2026-01-01','person_system',$5,$5)`,
          [...policy, timestamp]
        );
      }
    }

    const existingOperator = await this.one("SELECT operator_id FROM ops_operators LIMIT 1");
    if (!existingOperator) {
      const timestamp = new Date().toISOString();
      await this.exec(
        `INSERT INTO ops_operators
          (operator_id, person_id, operator_type, operator_status, amoeba_id, site_id,
           supervisor_person_id, daily_revenue_target_ngn, activated_at, created_at, updated_at)
         VALUES ($1, $2, 'driver', 'active', $3, $4, $2, 25000, $5, $5, $5)`,
        ["operator_demo_wole", "person_founder_wole", "amoeba_island", "site_island_1", timestamp]
      );
      await this.exec(
        `INSERT INTO ops_vehicles
          (vehicle_id, plate, vehicle_type, amoeba_id, make_model, color, status,
           assigned_operator_id, created_at, updated_at)
         VALUES ($1, $2, 'motorbike', $3, $4, $5, 'active', $6, $7, $7)`,
        ["vehicle_demo_001", "FLEXI-001", "amoeba_island", "Demo Fleet Bike", "Black", "operator_demo_wole", timestamp]
      );
      await this.exec("UPDATE ops_operators SET vehicle_id = $2 WHERE operator_id = $1", [
        "operator_demo_wole",
        "vehicle_demo_001"
      ]);
      await this.exec(
        `INSERT INTO ops_operator_platform_accounts
          (registration_id, operator_id, platform_account_id, platform_operator_id,
           registration_status, activated_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $5, $5)`,
        ["registration_demo_bolt", "operator_demo_wole", "platform_bolt_lagos", "bolt-demo-driver", timestamp]
      );
      await this.exec(
        `INSERT INTO ops_alerts
          (alert_id, operator_id, platform_account_id, alert_type, alert_date, tier,
           episode_key, fired_at, resolution_status, metadata)
         VALUES
          ('alert_demo_offline', 'operator_demo_wole', 'platform_bolt_lagos',
           'currently_offline', CURRENT_DATE, 0, 'demo-offline-period', $1, 'open',
           '{"offline_minutes": 42, "development_seed": true}'::jsonb),
          ('alert_demo_wait', 'operator_demo_wole', 'platform_bolt_lagos',
           'high_wait_ratio', CURRENT_DATE, 2, NULL, $1, 'open',
           '{"wait_ratio_pct": 34, "development_seed": true}'::jsonb)`,
        [timestamp]
      );
    }
  }

  private async seedScheduledJobs() {
    const timestamp = new Date().toISOString();
    for (const job of scheduledJobs) {
      await this.exec(
        `INSERT INTO ops_scheduled_jobs
         (job_name, owning_module, trigger_mechanism, schedule_wat, queue_name,
          timeout_seconds, max_attempts, backoff_seconds, idempotency_strategy,
          freshness_sla_minutes, dependencies, alert_recipients, source_finality,
          is_active, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14)
         ON CONFLICT (job_name) DO UPDATE SET
          owning_module=EXCLUDED.owning_module,
          trigger_mechanism=EXCLUDED.trigger_mechanism,
          schedule_wat=EXCLUDED.schedule_wat,
          queue_name=EXCLUDED.queue_name,
          timeout_seconds=EXCLUDED.timeout_seconds,
          max_attempts=EXCLUDED.max_attempts,
          backoff_seconds=EXCLUDED.backoff_seconds,
          idempotency_strategy=EXCLUDED.idempotency_strategy,
          freshness_sla_minutes=EXCLUDED.freshness_sla_minutes,
          dependencies=EXCLUDED.dependencies,
          alert_recipients=EXCLUDED.alert_recipients,
          source_finality=EXCLUDED.source_finality,
          updated_at=EXCLUDED.updated_at`,
        [
          job.job_name, job.owning_module, job.trigger_mechanism, job.schedule_wat,
          job.queue_name, job.timeout_seconds, job.max_attempts, job.backoff_seconds,
          job.idempotency_strategy, job.freshness_sla_minutes, job.dependencies,
          job.alert_recipients, job.source_finality, timestamp
        ]
      );
    }
  }
}
