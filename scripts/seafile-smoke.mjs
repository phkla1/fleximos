// Live smoke test for the Seafile document backend. Runs the real SeafileStore
// adapter (the same code ops-api uses) against the configured instance: uploads a
// small file to a three-deep path, reads it back, checks the bytes match, then
// deletes it and confirms it is gone. Prints PASS/FAIL.
//
// Run on the server with the FlexiMOS env loaded, e.g.:
//   set -a; . ~/fleximos-data/fleximos.env; set +a
//   npx tsx scripts/seafile-smoke.mjs
//
// It needs SEAFILE_BASE_URL, SEAFILE_API_TOKEN, SEAFILE_REPO_ID. It writes only a
// throwaway file under /_smoke/ in the FlexiMOS library and removes it again.
import { SeafileStore } from "../apps/ops-api/src/document-store.js";

const baseUrl = process.env.SEAFILE_BASE_URL;
const token = process.env.SEAFILE_API_TOKEN;
const repoId = process.env.SEAFILE_REPO_ID;

if (!baseUrl || !token || !repoId) {
  console.error("FAIL: SEAFILE_BASE_URL, SEAFILE_API_TOKEN and SEAFILE_REPO_ID must all be set.");
  console.error("Load the env first:  set -a; . ~/fleximos-data/fleximos.env; set +a");
  process.exit(1);
}

const store = new SeafileStore(baseUrl.replace(/\/$/, ""), token, repoId);
const stamp = Date.now();
const key = `/_smoke/${stamp}/hello-${stamp}.txt`;
const payload = Buffer.from(`fleximos seafile smoke ${new Date().toISOString()}\n`);

try {
  console.log(`Seafile: ${baseUrl}  repo ${repoId}`);
  console.log(`1/4 uploading ${key} (${payload.length} bytes, nested path) …`);
  const storagePath = await store.put(key, payload, "text/plain");
  console.log(`    stored at ${storagePath}`);

  console.log("2/4 downloading it back …");
  const got = await store.get(storagePath);
  if (!got.equals(payload)) {
    console.error(`FAIL: downloaded ${got.length} bytes did not match the ${payload.length} uploaded.`);
    process.exit(1);
  }
  console.log("    bytes match");

  console.log("3/4 deleting it …");
  await store.delete(storagePath);

  console.log("4/4 confirming it is gone …");
  let gone = false;
  try {
    await store.get(storagePath);
  } catch {
    gone = true;
  }
  if (!gone) {
    console.error("FAIL: file still readable after delete.");
    process.exit(1);
  }
  console.log("    gone");

  console.log("\nPASS: Seafile upload, download, delete all work. (A /_smoke/ folder may remain — harmless.)");
} catch (error) {
  console.error("\nFAIL:", error?.message || error);
  console.error("Check the token (Authorization: Token …), the repo UUID, and that ops-api's host can reach the base URL.");
  process.exit(1);
}
