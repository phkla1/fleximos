# FlexiMOS — Production Cutover Runbook

**Status (13 Nov 2026): PROD IS LIVE on `fleximos.hyve.com.ng`.** Provisioned 9 Nov; connectors wired to live creds and `FLEXI_INTEGRATIONS_ENV=production` (§6, 10 Nov); public nginx flip done (§7, 13 Nov). **The active task now is building the real org (§5)** — logging in as `wole` and entering staff/amoebas/operators. Rollback is still one line (§9).

Production is **co-resident with QA on the same Linode box** (`212.71.252.254`). It is a second, fully isolated instance — its own directory, ports, Postgres databases, env file and pm2 processes — not a migration of QA. QA (the former test instance) now lives at **`qamos.hyve.com.ng`**; production will take over **`fleximos.hyve.com.ng`** at the go-live flip.

| | QA (sandbox) | Production (LIVE) |
|---|---|---|
| URL | `https://qamos.hyve.com.ng` | `https://fleximos.hyve.com.ng` (LIVE — flipped 13 Nov) |
| Repo dir | `~/qamos` | `~/fleximos` |
| Data/env | `~/qamos-data` | `~/fleximos-data` |
| pm2 apps | `qamos-foundation/ops-api/payments/frontend` | `fleximos-foundation/ops-api/payments/frontend` |
| Ports | 4010 / 4030 / 4040 / 8080 | 4011 / 4031 / 4041 / **8081 (bound 127.0.0.1 = private)** |
| Postgres DBs | `fleximos_foundation/ops/payments` | `fleximos_prod_foundation/ops/payments` |
| Integrations | `test` (creds stripped, all platform accounts deactivated → no live calls) | **`production`** (live creds, 10 Nov) |
| Demo seed | on | **off (clean org)** |

---

## 0. Pre-cutover checklist (all true before the go-live flip)

- [ ] UAT signed off (all 12 stages) on QA.
- [ ] A maintenance window agreed (staff told the login URL is switching to the prod instance).
- [ ] **Production connector credentials in hand:** Bolt (`BOLT_CLIENT_ID`/`BOLT_CLIENT_SECRET`), Speedaf (`SPEEDAF_ACCOUNT`/`SPEEDAF_PASSWORD` + the delivery-customer id), Car Tracker, Tankvolt `*_PROD` key/host. (Uber is dropped.)
- [ ] Owner **bootstrap PIN rotated off the `000000` default** (§4) — do this before §7 makes the login public.
- [ ] Backups confirmed for the three `fleximos_prod_*` databases (§6 of `deploy/linode/README.md` covers `pg_dump`).

---

## 1. Production instance — DONE (9 Nov 2026)

Provisioned this session; recorded for reference / rebuild:
- Checkout copied from the QA checkout (same UAT-validated code + `node_modules`) into `~/fleximos`; data dirs under `~/fleximos-data`.
- Postgres role `fleximos_prod` + three empty databases `fleximos_prod_foundation` / `_ops` / `_payments` created (Postgres 16, `127.0.0.1:5432`).
- pm2 config `~/fleximos-data/ecosystem.config.cjs` (standalone, outside the repo so `git pull` stays clean) — names `fleximos-*`, ports 4011/4031/4041/8081, all bound `127.0.0.1`, `FLEXI_EMBED_JOBS=true` on ops-api, inter-service bases on the prod ports, and the frontend's `FOUNDATION_PORT/OPS_PORT/PAYMENTS_PORT` set to 4011/4031/4041 (critical — otherwise the frontend proxies to QA's backends). `pm2 save` done.

## 2. Production environment file — DONE (`~/fleximos-data/fleximos.env`, mode 600)

Set this session:
- `FLEXI_SERVICE_TOKEN` — fresh strong random (not the dev default).
- `FLEXI_{FOUNDATION,OPS,PAYMENTS}_DATABASE_URL` — the `fleximos_prod_*` databases, dedicated `fleximos_prod` role.
- `WEB_PUSH_VAPID_PUBLIC_KEY`/`_PRIVATE_KEY` — fresh VAPID keypair; `_SUBJECT=mailto:alerts@fleximotion.online`.
- `FLEXI_INTEGRATIONS_ENV=test` (no live partner calls yet — flipped to `production` at §6).
- `MONNIFY_PROVIDER_MODE=simulated`, `MEDIA_STRICT_CAPTURE=false`, `MEDIA_REQUIRE_GPS=false` (matches UAT; tighten media strictness post-launch once exercised on real devices).
- **No `FLEXI_SEED_DEMO`** → clean org. Connector `*_PROD` creds are NOT set yet (added at §6).

## 3. First boot — DONE & verified clean

- All four `fleximos-*` processes online (0 restarts); `/health` 200 on 4011/4031/4041; frontend 200 on `127.0.0.1:8081/apps/developer-portal/`.
- Schema auto-migrated; clean seed ran. Org verified clean: **people=1 (founder), operators=0, vehicles=0**, plus config defaults (4 platform-account definitions, 2 delivery-customer definitions, 17 scheduled jobs). Embedded-jobs worker polling confirmed.
- Isolation confirmed: prod foundation shows 1 person (not QA's 43); prod uses the `fleximos_prod_*` DBs.

## 4. Rotate the owner bootstrap PIN (owner action — before §7)

First boot seeded the founder owner (`user_founder_wole`, roles owner+admin, phone `+2348077999999`) with the **default bootstrap PIN `000000`** (because `FLEXI_BOOTSTRAP_PIN` was unset). Rotate it before the login page becomes public. The reset endpoint is private to the box (`127.0.0.1:4011`) and, as a mutating request, **requires an `Idempotency-Key` header**. SSH into the box, then run (prints the new PIN in your own terminal):

```
set -a; . ~/fleximos-data/fleximos.env; set +a; curl -s -X POST http://127.0.0.1:4011/identity/v1/users/user_founder_wole/reset-pin -H "Authorization: Bearer $FLEXI_SERVICE_TOKEN" -H "Content-Type: application/json" -H "Idempotency-Key: reset-wole-$(python3 -c 'import uuid;print(uuid.uuid4())')" -d '{"reset_by":"person_founder_wole"}' | python3 -m json.tool
```

Login is then **username `wole` + that PIN** (the console bakes in `@fleximotion.online`). Then: owner logs in → creates the staff users (admin/manager/finance/supervisor) in the HR/Identity console → HR/Ops create operators. Staff are created by hand (the batch importer covers operators, vehicles and hospitals only, not staff roles).

## 5. Build the real org — ACTIVE STEP (HR, via the consoles at `https://fleximos.hyve.com.ng`)

> **Access note:** administer prod only on the **public hostname**. The consoles' local mode (`flexiServiceBase`) targets the default ports 4010/4030/4040 + the dev token, so reaching prod via `localhost`/a plain SSH tunnel silently talks to **QA**. Use `https://fleximos.hyve.com.ng` (or, pre-flip, a non-`localhost` tunnel hostname).

Log in at **`/apps/hr-admin-console/`** as username **`wole`** + the rotated PIN (the console appends `@fleximotion.online`). Identity first, then structure, then people — order matters:

1. **People** (hr-admin → *People*) — each staff member: legal name, **phone, NIN**, email.
2. **Users & roles** (hr-admin → *Users & roles*) — a login per person with role(s) `owner`/`admin`/`manager`/`finance`/`supervisor`; **each PIN is shown once — record it**. No staff importer; this is by hand.
3. **Amoebas** (hr-admin → *Amoebas*) — create each amoeba, assign its **supervisor**.
4. **Sites** (hr-admin → *Sites*) — sites/accommodation (an amoeba may share a site, M:N).
5. **Operators** (ops-admin → *Bulk import*) — upload the operator CSV (**dry-runs by default**; commit after previewing). Then issue operator PINs. Accepted headers (any alias works): `full name` · `phone` · `nin` · `email` · `operator type` · `amoeba` *(must match a step-3 name)* · `site` · `operator class` · `start date` *(ramp maturity)* · `daily target` *(optional, defaults from policy)* · `vehicle plate` *(optional, links the bike)* · `status`.
6. **Vehicles / trackers** (ops-admin → *Vehicles*, *Trackers*) — load bikes; Tankvolt auto-links battery↔bike by VIN, so only the rider↔bike roster is managed here.
7. **Map platform drivers → operators** (ops-admin → *Data health → Unmapped platform drivers*) — connectors have been **live against an empty org since 10 Nov**, so real Bolt/Speedaf records sit in **quarantine**. Map each Bolt `driver_uuid` / Speedaf courier to its operator and **Map & backfill** — the retained history replays into daily records (nothing lost).
8. **Targets & policy** (ops-admin → *Targets & policy*) — confirm 25k/28k targets + bonus thresholds before announcing.
9. **Identity rule (critical):** match every real person on a strong key (NIN/phone), never a similar name — at volume there will be exact-name collisions.

## 6. Connect the platforms — DONE (10 Nov 2026)

1. The 8 live connector creds (`BOLT_CLIENT_ID`/`_SECRET`, `SPEEDAF_ACCOUNT`/`_PASSWORD`, `CARTRACKER_EMAIL`/`_PASSWORD`, `TANKVOLT_API_KEY`/`_API_BASE`) were copied from QA's env into `~/fleximos-data/fleximos.env`; `FLEXI_INTEGRATIONS_ENV=production` set (Monnify stays `simulated`); restarted via `pm2 delete … && pm2 start ~/fleximos-data/ecosystem.config.cjs && pm2 save` (a plain `pm2 restart` does **not** re-read the env file). `integration-status` verified: Bolt OAuth ok, Speedaf armed, Car Tracker + Tankvolt signed in. QA was sandboxed the same day (creds stripped, all platform accounts deactivated) so the two don't both hit the same partner accounts. Env backed up to `fleximos.env.bak.*`.
2. **Driver/courier mapping** is now part of the §5 build (step 7) — map Bolt `driver_uuid` + Speedaf couriers, backfill the quarantine.
3. Speedaf delivery customer: confirm `dcustomer_speedaf` exists in prod (or set its id).

## 7. Go live — PUBLIC FLIP — DONE (13 Nov 2026)

`fleximos.hyve.com.ng` now proxies to the prod instance. `/etc/nginx/sites-available/fleximos.hyve.com.ng` `proxy_pass` changed `http://127.0.0.1:8080` (QA) → **`http://127.0.0.1:8081`** (prod), `nginx -t` + `systemctl reload nginx`. Verified: people count via the public domain = 1 (founder), console 200. Config backed up to `…bak.*`. QA stays reachable at `qamos.hyve.com.ng`. **Still to do: announce the URL to staff** once §5 is populated.

## 8. Verify end-to-end (before announcing)

- [ ] Staff login works per role on `fleximos.hyve.com.ng`; operators sign in on the PWA.
- [ ] An ingest cycle lands real revenue; pacing/war-room populate; the ₦2k top-performer bonus computes on a day with data.
- [ ] Alerts fire (embedded jobs on); closeout reminders/escalations scheduled.
- [ ] Unmapped-driver queue + resolve/backfill works; unmapped-courier alert fires.
- [ ] Web-push: a supervisor receives an SOS; an operator receives an acknowledgement.
- [ ] A manual `pg_dump` of each `fleximos_prod_*` DB succeeds; restore path confirmed.

## 9. Rollback

Cutover is additive (a separate instance); QA is untouched. Rollback = revert the §7 nginx `proxy_pass` from `8081` back to `8080` (points `fleximos.hyve.com.ng` at QA again) and `reload nginx`. The prod instance keeps running privately on 8081 for investigation. Keep the last good `pg_dump` for restore.

## 10. First-day watch

Watch `pm2 monit`, job runs (failed ingests), the unmapped-driver/courier queues (new drivers appearing), and alert deliveries. Resolve mappings as drivers come online.

---

**Remaining owner work:** build the real org (§5), then verify end-to-end (§8) and announce the URL to staff. Provisioning, connectors (§6) and the public flip (§7) are all done.
