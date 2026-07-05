#!/usr/bin/env bash
# Fleximotion Linode installer. Run as root on a fresh Ubuntu 22.04/24.04 Linode
# after cloning the repository to /srv/fleximos:
#
#   git clone <your-repo-url> /srv/fleximos
#   bash /srv/fleximos/deploy/linode/install.sh
#
set -euo pipefail

REPO_DIR=/srv/fleximos
DEPLOY_DIR="$REPO_DIR/deploy/linode"

if [ ! -d "$REPO_DIR" ]; then
  echo "Clone the repository to $REPO_DIR first." >&2
  exit 1
fi

echo "==> Installing Node.js 20 and nginx"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx

echo "==> Creating the fleximos service user and data directories"
id fleximos >/dev/null 2>&1 || useradd --system --home /srv/fleximos --shell /usr/sbin/nologin fleximos
mkdir -p /var/lib/fleximos/{foundation-pglite,ops-pglite,payments-pglite,ops-media}
mkdir -p /etc/fleximos /var/backups/fleximos
chown -R fleximos:fleximos /var/lib/fleximos "$REPO_DIR"

echo "==> Installing npm dependencies (includes tsx runtime)"
cd "$REPO_DIR"
sudo -u fleximos npm ci

if [ ! -f /etc/fleximos/fleximos.env ]; then
  echo "==> Seeding /etc/fleximos/fleximos.env with a random service token"
  cp "$DEPLOY_DIR/fleximos.env.example" /etc/fleximos/fleximos.env
  sed -i "s/change-me-to-a-long-random-string/$(openssl rand -hex 32)/" /etc/fleximos/fleximos.env
  chmod 640 /etc/fleximos/fleximos.env
  chown root:fleximos /etc/fleximos/fleximos.env
fi

echo "==> Installing systemd units"
cp "$DEPLOY_DIR"/systemd/*.service "$DEPLOY_DIR"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker
systemctl enable --now fleximos-ops-scheduler.timer

echo "==> Installing the nginx site (edit server_name before going live)"
cp "$DEPLOY_DIR/nginx/fleximos.conf" /etc/nginx/sites-available/fleximos.conf
ln -sf /etc/nginx/sites-available/fleximos.conf /etc/nginx/sites-enabled/fleximos.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Installing the nightly database backup timer"
cat > /etc/cron.daily/fleximos-backup <<'CRON'
#!/bin/sh
tar -czf "/var/backups/fleximos/fleximos-data-$(date +%F).tar.gz" -C /var/lib fleximos
find /var/backups/fleximos -name 'fleximos-data-*.tar.gz' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/fleximos-backup

echo "==> Waiting for services"
sleep 5
for port in 4010 4030 4040; do
  curl -fsS "http://127.0.0.1:$port/health" >/dev/null && echo "  service on :$port healthy" || echo "  WARNING: service on :$port not responding yet"
done

echo
echo "Done. Next steps:"
echo "  1. Edit server_name in /etc/nginx/sites-available/fleximos.conf and reload nginx."
echo "  2. (Optional) point a domain at this Linode and run: apt install certbot python3-certbot-nginx && certbot --nginx"
echo "  3. Seed demo data for training: see deploy/linode/README.md, 'Seeding'."
echo "  4. Open http://<server>/apps/developer-portal/ to verify."
