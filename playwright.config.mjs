import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "node scripts/serve-developer-portal.mjs",
      url: "http://127.0.0.1:4173/apps/developer-portal/",
      reuseExistingServer: true,
      timeout: 10000
    },
    {
      command: "PORT=4510 FLEXI_DB_DIR=.data/e2e-foundation-pglite node apps/api-foundation/server.mjs",
      url: "http://127.0.0.1:4510/health",
      reuseExistingServer: true,
      timeout: 15000
    },
    {
      command: "PORT=4530 FLEXI_OPS_DB_DIR=.data/e2e-ops-pglite npx tsx apps/ops-api/src/main.ts",
      url: "http://127.0.0.1:4530/health",
      reuseExistingServer: true,
      timeout: 20000
    },
    {
      command: "PORT=4542 FLEXI_PAYMENTS_DB_DIR=.data/e2e-payments-pglite OPS_API_BASE=http://127.0.0.1:4530 node apps/payments-integration/server.mjs",
      url: "http://127.0.0.1:4542/health",
      reuseExistingServer: true,
      timeout: 15000
    }
  ],
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"]
      }
    }
  ]
});
