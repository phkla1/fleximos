// pm2 process definitions for the FlexiMOS suite.
//
//   pm2 start deploy/linode/ecosystem.config.cjs
//   pm2 save
//
// Everything lives under the invoking user's home directory:
// repo at ~/fleximos, data at ~/fleximos-data, secrets in
// ~/fleximos-data/fleximos.env (loaded below and merged into every app).
const fs = require("node:fs");
const path = require("node:path");

const HOME = process.env.HOME;
const REPO = path.join(HOME, "fleximos");
const DATA = path.join(HOME, "fleximos-data");

const fileEnv = {};
const envFile = path.join(DATA, "fleximos.env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !line.trim().startsWith("#")) fileEnv[match[1]] = match[2];
  }
}

const common = {
  cwd: REPO,
  time: true,               // timestamps in pm2 logs
  max_restarts: 10,
  restart_delay: 3000
};

module.exports = {
  apps: [
    {
      ...common,
      name: "fleximos-foundation",
      script: "apps/api-foundation/server.mjs",
      env: { ...fileEnv, PORT: "4010", HOST: "127.0.0.1", FLEXI_DB_DIR: `${DATA}/foundation-pglite` }
    },
    {
      ...common,
      name: "fleximos-ops-api",
      script: "apps/ops-api/src/main.ts",
      interpreter: path.join(REPO, "node_modules/.bin/tsx"),
      env: {
        ...fileEnv,
        PORT: "4030",
        HOST: "127.0.0.1",
        FLEXI_OPS_DB_DIR: `${DATA}/ops-pglite`,
        FLEXI_OPS_MEDIA_DIR: `${DATA}/ops-media`,
        FOUNDATION_API_BASE: "http://127.0.0.1:4010",
        PAYMENTS_API_BASE: "http://127.0.0.1:4040"
      }
    },
    {
      ...common,
      name: "fleximos-payments",
      script: "apps/payments-integration/server.mjs",
      env: {
        ...fileEnv,
        PORT: "4040",
        HOST: "127.0.0.1",
        FLEXI_PAYMENTS_DB_DIR: `${DATA}/payments-pglite`,
        OPS_API_BASE: "http://127.0.0.1:4030"
      }
    },
    {
      ...common,
      name: "fleximos-ops-worker",
      script: "apps/ops-api/src/worker.ts",
      interpreter: path.join(REPO, "node_modules/.bin/tsx"),
      restart_delay: 5000,
      env: {
        ...fileEnv,
        FLEXI_OPS_DB_DIR: `${DATA}/ops-pglite`,
        FLEXI_OPS_MEDIA_DIR: `${DATA}/ops-media`,
        FOUNDATION_API_BASE: "http://127.0.0.1:4010",
        PAYMENTS_API_BASE: "http://127.0.0.1:4040"
      }
    },
    {
      // One-shot scheduler tick, re-run by pm2 every minute (cron_restart with
      // autorestart off is the pm2 pattern for cron-style jobs).
      ...common,
      name: "fleximos-ops-scheduler",
      script: "apps/ops-api/src/scheduler.ts",
      args: "--once",
      interpreter: path.join(REPO, "node_modules/.bin/tsx"),
      autorestart: false,
      cron_restart: "* * * * *",
      env: { ...fileEnv, FLEXI_OPS_DB_DIR: `${DATA}/ops-pglite` }
    },
    {
      // Public entry: static frontends + /services/* proxy on port 8080.
      ...common,
      name: "fleximos-frontend",
      script: "scripts/serve-developer-portal.mjs",
      env: { ...fileEnv, PORT: "8080", HOST: "0.0.0.0" }
    }
  ]
};
