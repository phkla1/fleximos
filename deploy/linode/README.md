# Deploying FlexiMOS to a Linode server

This runbook takes the suite from a fresh Ubuntu 22.04/24.04 Linode to a working
acceptance-testing environment. It deploys the current "local review" stack —
PGlite file databases, simulated Monnify mode and the development service-token
model — which is exactly what user acceptance testing and training need. The
production-hardening gates (PostgreSQL, Redis/BullMQ, live platform and Monnify
credentials, per-user authentication hardening) are listed at the end and in
`deploy/phase3-runtime.md`.

## What runs where

| Process | Port | systemd unit |
|---|---|---|
| Foundation API (Identity + Amoeba) | 4010 | `fleximos-foundation` |
| Ops API | 4030 | `fleximos-ops-api` |
| Payments Integration (Monnify) | 4040 | `fleximos-payments` |
| Ops worker (queues, alerts, reports) | — | `fleximos-ops-worker` |
| Ops scheduler tick (every minute) | — | `fleximos-ops-scheduler.timer` |
| nginx (static frontends + `/services/*` proxies) | 80/443 | `nginx` |

All backend ports bind to `127.0.0.1` only; nginx is the single public entry
point. The frontends automatically talk to `/services/foundation`,
`/services/ops` and `/services/payments` on the same origin whenever they are
not served from localhost (see `apps/role-console-assets/flexi-env.js`), so no
frontend configuration is needed.

Data lives outside the repository:

- `/var/lib/fleximos/{foundation,ops,payments}-pglite` — databases
- `/var/lib/fleximos/ops-media` — camera-capture media files
- `/etc/fleximos/fleximos.env` — secrets and feature flags
- `/var/backups/fleximos` — nightly data snapshots (14-day retention)

## 1. Provision

A shared-CPU Linode with 2 GB RAM is enough for UAT. Attach your SSH key,
pick a region close to Lagos users (e.g. Frankfurt or London), and note the IP.

## 2. Install

```bash
ssh root@<linode-ip>
apt-get update && apt-get install -y git
git clone <your-repo-url> /srv/fleximos
bash /srv/fleximos/deploy/linode/install.sh
```

The installer:

1. Installs Node.js 20 and nginx.
2. Creates the `fleximos` system user and the data directories.
3. Runs `npm ci`.
4. Writes `/etc/fleximos/fleximos.env` with a random service token.
5. Installs and starts the five systemd units plus the scheduler timer.
6. Installs the nginx site and a nightly backup cron job.

## 3. Domain and TLS (recommended)

```bash
# after pointing an A record at the Linode:
sed -i 's/fleximos.example.com/uat.yourdomain.com/' /etc/nginx/sites-available/fleximos.conf
nginx -t && systemctl reload nginx
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d uat.yourdomain.com
```

IP-only access also works (leave `server_name` as-is; nginx serves the default
site); use `http://<linode-ip>/apps/...` URLs.

## 4. Seed demo/training data

The APIs self-seed reference data (platform accounts, pace profiles, policies).
For realistic training rosters and history, run the demo seed once:

```bash
cd /srv/fleximos
sudo -u fleximos FOUNDATION_API_BASE=http://127.0.0.1:4010 \
  OPS_API_BASE=http://127.0.0.1:4030 \
  FLEXI_SERVICE_TOKEN=$(grep FLEXI_SERVICE_TOKEN /etc/fleximos/fleximos.env | cut -d= -f2) \
  node scripts/seed-ops-demo.mjs
```

The seed is idempotent — running it again does not duplicate data.

## 5. Verify

```bash
curl -s http://127.0.0.1:4010/health
curl -s http://127.0.0.1:4030/health
curl -s http://127.0.0.1:4040/health
systemctl status fleximos-ops-worker fleximos-ops-scheduler.timer --no-pager
```

Then in a browser:

- `https://<host>/apps/developer-portal/` — portal and suite directory
- `https://<host>/apps/ops-admin-console/` — Ops admin
- `https://<host>/apps/ops-console/` — supervisor workspace
- `https://<host>/apps/manager-console/` — manager console
- `https://<host>/apps/finance-console/` — finance console
- `https://<host>/apps/analytics-console/` — analytics control room
- `https://<host>/apps/operator-pwa/` — operator app (login: phone + PIN `000000` for seeded users)
- `https://<host>/apps/admin-console/` — Identity/Amoeba admin

The acceptance-test scripts in `docs/acceptance-tests/` use these URLs.

## 6. Updating the deployment

```bash
cd /srv/fleximos
sudo -u fleximos git pull
sudo -u fleximos npm ci
systemctl restart fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
```

Databases live in `/var/lib/fleximos`, so restarts and code updates never lose
data. To reset the environment for a fresh training round, stop the services,
delete the three `*-pglite` directories, start the services and re-run the seed.

## 7. Backups and restore

`/etc/cron.daily/fleximos-backup` snapshots `/var/lib/fleximos` nightly to
`/var/backups/fleximos` and keeps 14 days. To restore:

```bash
systemctl stop fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
tar -xzf /var/backups/fleximos/fleximos-data-<date>.tar.gz -C /var/lib
chown -R fleximos:fleximos /var/lib/fleximos
systemctl start fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
```

## 8. Security posture for UAT

- Backend ports are loopback-only; nginx is the sole public surface.
- The service token in `/etc/fleximos/fleximos.env` is random per install.
  Anyone holding it has full service access — share it only with testers who
  need console access, and rotate it (edit the file, restart services) after
  the testing round.
- Human logins (operator PWA and Identity sessions) use phone + PIN via the
  Foundation API; seeded development users have PIN `000000`.
- Enable the Linode Cloud Firewall: allow 22, 80, 443 inbound; deny the rest.

## 9. Production-hardening gates (later, not needed for UAT)

- PostgreSQL with backups/restore drills, Redis + BullMQ (see `deploy/phase3-runtime.md`).
- Live Bolt/Uber connector credentials and a real end-to-end trial.
- Monnify sandbox → live credentials, public webhook URL and signature checks
  (`docs/developer-portal/monnify-setup-and-test.md`).
- Real tracker ingestion for car mileage.
- Per-role human authentication in every console (replacing the shared
  development token) and audit-grade session management.
