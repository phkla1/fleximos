import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test as setup } from "@playwright/test";

const run = promisify(execFile);

setup("seed demo data into the e2e databases", async () => {
  setup.setTimeout(240000);
  const { stdout } = await run("node", ["scripts/seed-ops-demo.mjs"], {
    env: {
      ...process.env,
      FOUNDATION_API_BASE: "http://127.0.0.1:4510",
      OPS_API_BASE: "http://127.0.0.1:4530"
    }
  });
  console.log(stdout.trim());
});
