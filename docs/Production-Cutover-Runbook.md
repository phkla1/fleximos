# FlexiMOS — Production Cutover Runbook

**Status:** DRAFT for owner review (8 Nov 2026). **Do not execute without Wole's explicit go-ahead** — cutover stands up the real production instance and onboards real people.

This is the ordered go-live sequence. It does **not** repeat the mechanics in
`deploy/linode/README.md` (provisioning, install, Postgres, nginx/TLS, pm2,
backups) — it references those sections and adds only what's cutover-specific:
a clean prod instance, real-org onboarding with strong identity, flipping
integrations to production, verification, and rollback.

Production is a **fresh, separate instance** — not the UAT/test box
(`fleximos.hyve.com.ng`), which holds demo data mixed with the real Bolt/Speedaf
ops. Nothing is migrated from the test box; the prod org is built clean.

---

## 0. Pre-cutover checklist (all must be true before starting)

- [ ] UAT signed off (remaining stages complete).
- [ ] A maintenance window agreed (operators/supervisors told to expect a brief switch).
- [ ] **Production connector credentials in hand:** Bolt (`BOLT_CLIENT_ID`/`BOLT_CLIENT_SECRET`), Speedaf (`SPEEDAF_ACCOUNT`/`SPEEDAF_PASSWORD`, and the Speedaf delivery-customer id), Car Tracker, Tankvolt `*_PROD` key/host. (Uber is dropped — not needed.)
- [ ] The real org structure decided: amoebas, sites, supervisors, the staff roster (managers/finance/admin), and the operator roster — each person with **NIN and/or phone** (identity is matched on a strong key, never on name).
- [ ] A fresh VAPID keypair generated for web-push (`npx web-push generate-vapid-keys`).
- [ ] A strong random `FLEXI_SERVICE_TOKEN` generated for prod (not the dev default).

---

## 1. Provision the production instance

Follow `deploy/linode/README.md`:
- §1 Provision, §2 Install (clone, `install.sh`).
- §9 **PostgreSQL** — create the three prod databases and set `FLEXI_OPS_DATABASE_URL` / `FLEXI_FOUNDATION_DATABASE_URL` / the payments URL. Production runs on Postgres, not PGlite.
- §5 nginx + TLS for the production hostname.
- §5b Run under **pm2** from `deploy/linode/ecosystem.config.cjs` (which hardcodes `FLEXI_EMBED_JOBS=true`, so alerts/ingests/daily jobs actually run — see memory `fleximos-embed-jobs-gotcha`).

## 2. Production environment file (`~/fleximos-data/fleximos.env`)

Set, from `fleximos.env.example`:
- `FLEXI_SERVICE_TOKEN=<strong random>` — the shared service token. In prod it is NOT handed out as a `?token=` link; staff log in per-user (see §5).
- `FLEXI_OPS_DATABASE_URL` / `FLEXI_FOUNDATION_DATABASE_URL` / payments URL — prod Postgres.
- `WEB_PUSH_VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` / `_SUBJECT` — the fresh VAPID keypair.
- Connector creds: `BOLT_CLIENT_ID`/`BOLT_CLIENT_SECRET`, `SPEEDAF_ACCOUNT`/`SPEEDAF_PASSWORD` (+ `SPEEDAF_CUSTOMER_ID` once the customer exists), Car Tracker, `TANKVOLT_API_KEY_PROD`/`_BASE_PROD`.
- `FLEXI_INTEGRATIONS_ENV=production` — flips connectors (e.g. Tankvolt) to their production hosts/keys. **Leave this out until §6** so you don't hit prod partners before the org is ready.
- **Do NOT set `FLEXI_SEED_DEMO`.** A clean install leaves the org empty for HR to build, and the seed already retires Uber.
- Optional: `FLEXI_ACCESS_TTL_MIN` (default 60) / `FLEXI_REFRESH_TTL_DAYS` (default 30) for session lifetimes.

## 3. First boot (empty org)

- Start the stack (pm2). On boot the schema auto-migrates (all tables) and the clean seed runs: baseline pace/economics/flexi-points/top-performer config, scheduled jobs registered, **Uber accounts created inactive**, org empty.
- Verify per README §3 (health endpoints green, Swagger reachable) and confirm the startup log line `Embedded jobs: worker polling …` (jobs on).

## 4. Build the real org (HR, via the consoles)

Order matters — identity first, then structure, then people:
1. **People + staff users** in the HR/Identity admin console: each with legal name, **phone, and NIN**. Create login users with the right roles (`owner`/`admin`/`manager`/`finance`/`supervisor`); each is issued a PIN at creation (shown once).
2. **Amoebas + sites** and assign each amoeba its supervisor.
3. **Operators** (riders/drivers): create, assign amoeba + site + vehicle, activate. Issue their PINs. Weekly onboarding cohorts auto-form once an operator is active + has a vehicle.
4. **Identity rule (critical):** match every real person on a strong key (NIN/phone), never a similar name — at volume there will be exact-name collisions (see memory `fleximos-identity-matching`). A wrong mapping corrupts pay.

## 5. Authentication cutover

- Staff use **per-user login** (phone + PIN) at each console — no `?token=` service-token links in production. (The link path still technically works as a break-glass fallback; don't distribute it.)
- Operators sign in to the PWA with phone + PIN.
- Confirm the old forgeable `dev_access_` scheme is dead (it is — session tokens are opaque/expiring/revocable; see memory `fleximos-session-auth`).

## 6. Connect the platforms (flip to production)

1. Set `FLEXI_INTEGRATIONS_ENV=production` + the `*_PROD` connector creds in the env file, then restart from the ecosystem file so the env is re-read (`pm2 delete … && pm2 start … --update-env`; a plain restart does **not** re-read the env file).
2. **Map platform drivers → operators:**
   - Bolt: register each active driver's `driver_uuid` to its operator (ops-admin / platform registration). Any driver that earns before being mapped is **retained and surfaced** in ops-admin → Data health → "Unmapped platform drivers" — map there and it backfills automatically (safeguard phase 2).
   - Speedaf: map each courier name → operator via the courier aliases; unmapped couriers are retained (`ops_speedaf_waybills`) and alerted to ops-admin/HR.
3. Confirm the Speedaf "Speedaf" delivery customer exists (or set `SPEEDAF_CUSTOMER_ID`).

## 7. Verify end-to-end (before announcing go-live)

- [ ] Staff login works per role; operators can sign in on the PWA.
- [ ] An ingest cycle lands real revenue (check `/ops/v1/daily-performance`); pacing/war-room populate; the ₦2k top-performer bonus computes on a day with data.
- [ ] Alerts fire (embedded jobs on); closeout reminders/escalations scheduled.
- [ ] Unmapped-driver queue + resolve/backfill works; unmapped-courier alert fires.
- [ ] Web-push: a supervisor receives an SOS; an operator receives an acknowledgement.
- [ ] Backups: `backup-postgres` runs (README §7); take one manual `pg_dump` now and confirm restore procedure.
- [ ] Load: optionally re-run `tools/loadtest/loadtest.mjs` against prod (sizing verdict: 4 vCPU/8GB is ample — memory `fleximos-load-sizing`).

## 8. Go live

- Point the production DNS/hostname at the instance (or enable it in nginx).
- Announce to staff; distribute console URLs (bare URLs — they'll log in).

## 9. Rollback

- Cutover is additive (a fresh instance); the test box is untouched, so "rollback" = don't flip DNS / keep staff on the current workflow.
- If a problem surfaces post-DNS: revert DNS to the prior state, investigate on the prod instance, re-cut when fixed. Keep the last good `pg_dump` for restore.

## 10. First-day watch

- Watch pm2 (`pm2 monit`), job runs (failed ingests), the unmapped-driver/courier queues (new drivers appearing), and alert deliveries. Resolve mappings as drivers come online.

---

**Open inputs needed from the owner before execution:** production hostname, the prod connector credentials (§0), and the real staff/operator roster with NIN/phone. Everything else above is mechanical and ready.
