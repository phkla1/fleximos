# Deploying FlexiMOS to a Linode server

This runbook takes the suite from a fresh Ubuntu 22.04/24.04 Linode to a
working acceptance-testing environment **without requiring root access**.
Everything lives under your home directory: the repository in `~/fleximos`,
databases and media in `~/fleximos-data`, backups in `~/fleximos-backups`,
and services as systemd *user* units in `~/.config/systemd/user`.

It deploys the current "local review" stack — PGlite file databases, simulated
Monnify mode and the development service-token model — which is exactly what
user acceptance testing and training need. The production-hardening gates
(PostgreSQL, Redis/BullMQ, live platform and Monnify credentials, per-user
authentication hardening) are listed at the end and in
`deploy/phase3-runtime.md`.

## What runs where

| Process | Port | systemd user unit |
|---|---|---|
| Frontend host + `/services/*` proxy (public entry) | 8080 | `fleximos-frontend` |
| Foundation API (Identity + Amoeba) | 4010 | `fleximos-foundation` |
| Ops API | 4030 | `fleximos-ops-api` |
| Payments Integration (Monnify) | 4040 | `fleximos-payments` |
| Ops worker (queues, alerts, reports) | — | `fleximos-ops-worker` |
| Ops scheduler tick (every minute) | — | `fleximos-ops-scheduler.timer` |

The three API ports bind to `127.0.0.1` only. The frontend host on port 8080
is the single public surface: it serves every console from the repository and
proxies `/services/foundation`, `/services/ops` and `/services/payments` to
the local APIs. The frontends resolve those same-origin routes automatically
whenever they are not on localhost (see
`apps/role-console-assets/flexi-env.js`), so no frontend configuration is
needed and no root-owned web server is required.

Layout on the server:

- `~/fleximos` — repository checkout (code and static frontends)
- `~/fleximos-data/{foundation,ops,payments}-pglite` — databases
- `~/fleximos-data/ops-media` — camera-capture media files
- `~/fleximos-data/fleximos.env` — secrets and feature flags (chmod 600)
- `~/fleximos-backups` — nightly data snapshots (14-day retention)

## 1. Provision

A shared-CPU Linode with 2 GB RAM is enough for UAT. Attach your SSH key,
pick a region close to Lagos users (e.g. Frankfurt or London), and note the
IP. Create a regular (non-root) user if you were only given root, or use the
account your host provided — the installer never needs to leave `$HOME`.

## 2. Install

```bash
ssh <user>@<linode-ip>
git clone <your-repo-url> ~/fleximos
bash ~/fleximos/deploy/linode/install.sh
```

The installer:

1. Installs Node.js 22 via nvm into your home directory if the system has no
   Node 20+ (no root needed; an existing system Node 20+ is used as-is).
2. Creates `~/fleximos-data` and `~/fleximos-backups`.
3. Runs `npm ci`.
4. Writes `~/fleximos-data/fleximos.env` with a random service token.
5. Installs the six systemd **user** units plus the scheduler timer and starts
   them with `systemctl --user`.
6. Adds a nightly backup entry to your user crontab.

Two follow-ups it will remind you about:

- **Lingering** (one-time, the only step that wants sudo):
  `sudo loginctl enable-linger $USER` keeps your user services running after
  you log out. If you have no sudo at all, ask your host to enable lingering
  for your account — without it, user services stop when your last SSH
  session ends.
- **Firewall**: open inbound TCP 8080 (plus 22) in the Linode Cloud Firewall
  from the Linode dashboard — no server-side root needed.

## 3. Verify

```bash
curl -s http://127.0.0.1:4010/health
curl -s http://127.0.0.1:4030/health
curl -s http://127.0.0.1:4040/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/apps/developer-portal/
systemctl --user status fleximos-ops-worker fleximos-ops-scheduler.timer --no-pager
```

Then in a browser (`http://<linode-ip>:8080` or your domain):

- `…/apps/developer-portal/` — portal and suite directory
- `…/apps/ops-admin-console/` — Ops admin
- `…/apps/ops-console/` — supervisor workspace
- `…/apps/manager-console/` — manager console
- `…/apps/finance-console/` — finance console
- `…/apps/analytics-console/` — analytics control room
- `…/apps/operator-pwa/` — operator app (login: phone + PIN `000000` for seeded users)
- `…/apps/admin-console/` — Identity/Amoeba admin

**Console access tokens:** the deployed server uses the random service token
in `~/fleximos-data/fleximos.env`, so consoles opened bare will show
"Missing or invalid bearer token". Give each tester a tokenised link once:

```text
https://<host>/apps/manager-console/?token=<FLEXI_SERVICE_TOKEN value>
```

The console stores the token in that browser and every later visit (any
console, no query string) works normally. The operator PWA is unaffected —
operators sign in with phone + PIN.

The acceptance-test scripts in `docs/acceptance-tests/` use these URLs.

## 4. Seed demo/training data

The APIs self-seed reference data (platform accounts, pace profiles,
policies). For realistic training rosters and history, run the demo seed once:

```bash
cd ~/fleximos
FOUNDATION_API_BASE=http://127.0.0.1:4010 \
OPS_API_BASE=http://127.0.0.1:4030 \
FLEXI_SERVICE_TOKEN=$(grep FLEXI_SERVICE_TOKEN ~/fleximos-data/fleximos.env | cut -d= -f2) \
node scripts/seed-ops-demo.mjs
```

The seed is idempotent — running it again does not duplicate data.

## 5. Optional: nginx and TLS

Port 8080 over plain HTTP is fine for a private UAT round. When you want a
domain on standard ports with HTTPS (recommended before real phone numbers
and cash figures go in), add the nginx layer — this is the one part that
needs sudo, and it is a thin proxy to port 8080:

```bash
sudo apt-get install -y nginx
sudo cp ~/fleximos/deploy/linode/nginx/fleximos.conf /etc/nginx/sites-available/fleximos.conf
sudo sed -i 's/fleximos.example.com/uat.yourdomain.com/' /etc/nginx/sites-available/fleximos.conf
sudo ln -sf /etc/nginx/sites-available/fleximos.conf /etc/nginx/sites-enabled/fleximos.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d uat.yourdomain.com
```

Then also open ports 80/443 in the Cloud Firewall (8080 can be closed again).

## 6. Updating the deployment

```bash
cd ~/fleximos
git pull
npm ci
systemctl --user restart fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker fleximos-frontend
```

Databases live in `~/fleximos-data`, so restarts and code updates never lose
data. To reset the environment for a fresh training round:

```bash
systemctl --user stop fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
rm -rf ~/fleximos-data/{foundation,ops,payments}-pglite
systemctl --user start fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
# then re-run the seed (section 4)
```

## 7. Backups and restore

The user crontab entry snapshots `~/fleximos-data` nightly into
`~/fleximos-backups` and keeps 14 days (`crontab -l` to inspect). To restore:

```bash
systemctl --user stop fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
tar -xzf ~/fleximos-backups/fleximos-data-<date>.tar.gz -C ~
systemctl --user start fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
```

## 8. Security posture for UAT

- API ports are loopback-only; the frontend host on 8080 is the sole public
  surface.
- The service token in `~/fleximos-data/fleximos.env` is random per install
  and the file is `chmod 600`. Anyone holding the token has full service
  access — share it only with testers who need console access, and rotate it
  (edit the file, restart services) after the testing round.
- Human logins (operator PWA and Identity sessions) use phone + PIN via the
  Foundation API; seeded development users have PIN `000000`.
- Use the Linode Cloud Firewall: allow 22 and 8080 (or 80/443 with nginx)
  inbound; deny the rest.

## 9. Production-hardening gates (later, not needed for UAT)

- PostgreSQL with backups/restore drills, Redis + BullMQ (see `deploy/phase3-runtime.md`).
- Live Bolt/Uber connector credentials and a real end-to-end trial.
- Monnify sandbox → live credentials, public webhook URL and signature checks
  (`docs/developer-portal/monnify-setup-and-test.md`).
- Real tracker ingestion for car mileage.
- Per-role human authentication in every console (replacing the shared
  development token) and audit-grade session management.
