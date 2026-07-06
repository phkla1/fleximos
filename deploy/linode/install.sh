#!/usr/bin/env bash
# Fleximotion Linode installer — runs entirely as a regular user, with
# everything under your home directory. No root access is required for the
# core install; sudo is only suggested for two optional conveniences
# (login lingering and nginx/TLS), and the script tells you when.
#
#   git clone <your-repo-url> ~/fleximos
#   bash ~/fleximos/deploy/linode/install.sh
#
set -euo pipefail

REPO_DIR="$HOME/fleximos"
DATA_DIR="$HOME/fleximos-data"
BACKUP_DIR="$HOME/fleximos-backups"
DEPLOY_DIR="$REPO_DIR/deploy/linode"
UNIT_DIR="$HOME/.config/systemd/user"

if [ ! -d "$REPO_DIR" ]; then
  echo "Clone the repository to $REPO_DIR first (git clone <url> ~/fleximos)." >&2
  exit 1
fi

echo "==> Checking for Node.js 20+"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$major" -ge 20 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  echo "==> Installing Node.js 22 with nvm (user-level, no root needed)"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm alias default 22
fi
NODE_BIN="$(command -v node)"
echo "    using node at $NODE_BIN ($(node -v))"

echo "==> Creating data and backup directories under \$HOME"
mkdir -p "$DATA_DIR"/{foundation-pglite,ops-pglite,payments-pglite,ops-media} "$BACKUP_DIR"

echo "==> Installing npm dependencies (includes tsx runtime)"
cd "$REPO_DIR"
npm ci

if [ ! -f "$DATA_DIR/fleximos.env" ]; then
  echo "==> Seeding $DATA_DIR/fleximos.env with a random service token"
  cp "$DEPLOY_DIR/fleximos.env.example" "$DATA_DIR/fleximos.env"
  token="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  sed -i "s/change-me-to-a-long-random-string/$token/" "$DATA_DIR/fleximos.env"
  chmod 600 "$DATA_DIR/fleximos.env"
fi

echo "==> Installing systemd user units to $UNIT_DIR"
mkdir -p "$UNIT_DIR"
for unit in "$DEPLOY_DIR"/systemd/*.service "$DEPLOY_DIR"/systemd/*.timer; do
  sed "s|__NODE_BIN__|$NODE_BIN|g" "$unit" > "$UNIT_DIR/$(basename "$unit")"
done
systemctl --user daemon-reload
systemctl --user enable --now fleximos-foundation fleximos-ops-api fleximos-payments fleximos-ops-worker fleximos-frontend
systemctl --user enable --now fleximos-ops-scheduler.timer

echo "==> Installing the nightly backup entry in your user crontab"
cron_line="@daily tar -czf $BACKUP_DIR/fleximos-data-\$(date +\\%F).tar.gz -C $HOME fleximos-data && find $BACKUP_DIR -name 'fleximos-data-*.tar.gz' -mtime +14 -delete"
( crontab -l 2>/dev/null | grep -v "fleximos-data-" ; echo "$cron_line" ) | crontab -

echo "==> Waiting for services"
sleep 5
for port in 4010 4030 4040 8080; do
  curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && echo "  service on :$port healthy" \
    || { [ "$port" = 8080 ] && curl -fsS "http://127.0.0.1:8080/apps/developer-portal/" >/dev/null 2>&1 && echo "  frontend on :8080 healthy"; } \
    || echo "  WARNING: service on :$port not responding yet"
done

echo
echo "Done. The suite is served on port 8080 (frontends + /services proxy)."
echo
echo "Follow-ups:"
echo "  1. Keep services running after you log out (one-time, needs sudo):"
echo "       sudo loginctl enable-linger $USER"
echo "     Without lingering, services stop when your last SSH session ends."
echo "  2. Open port 8080 in the Linode Cloud Firewall (dashboard, no server access needed),"
echo "     then browse to http://<linode-ip>:8080/apps/developer-portal/"
echo "  3. Optional domain + TLS on port 443: see 'Optional: nginx and TLS' in deploy/linode/README.md."
echo "  4. Seed demo data for training: see deploy/linode/README.md, 'Seeding'."
