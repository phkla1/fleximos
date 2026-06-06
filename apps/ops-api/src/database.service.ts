import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PGlite } from "@electric-sql/pglite";

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
        daily_revenue_target_ngn NUMERIC(12, 2),
        activated_at TIMESTAMPTZ,
        deactivated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

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
    `);

    await this.seed();
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
}
