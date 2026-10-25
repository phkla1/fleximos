import assert from "node:assert/strict";
import { test } from "node:test";
import { integrationsMode, integrationVar } from "../../apps/ops-api/src/integration-env.js";
import { createTrackerConnectors } from "../../apps/ops-api/src/connectors/tracker.factory.js";

test("integrationsMode defaults to test and recognises production aliases", () => {
  assert.equal(integrationsMode({} as any), "test");
  assert.equal(integrationsMode({ FLEXI_INTEGRATIONS_ENV: "test" } as any), "test");
  assert.equal(integrationsMode({ FLEXI_INTEGRATIONS_ENV: "production" } as any), "production");
  assert.equal(integrationsMode({ FLEXI_INTEGRATIONS_ENV: "PROD" } as any), "production");
  assert.equal(integrationsMode({ FLEXI_INTEGRATIONS_ENV: "live" } as any), "production");
});

test("integrationVar prefers the suffixed value, else falls back to the bare name", () => {
  const env: any = {
    FLEXI_INTEGRATIONS_ENV: "test",
    TANKVOLT_API_KEY: "bare-key",
    TANKVOLT_API_KEY_TEST: "test-key",
    TANKVOLT_API_KEY_PROD: "prod-key"
  };
  assert.equal(integrationVar(env, "TANKVOLT_API_KEY"), "test-key");
  assert.equal(integrationVar({ ...env, FLEXI_INTEGRATIONS_ENV: "production" }, "TANKVOLT_API_KEY"), "prod-key");
  // Bare value is used when no scoped override exists (existing single-value setups).
  assert.equal(integrationVar({ FLEXI_INTEGRATIONS_ENV: "production", TANKVOLT_API_KEY: "bare-key" } as any, "TANKVOLT_API_KEY"), "bare-key");
  // Blank override does not mask the bare value.
  assert.equal(integrationVar({ TANKVOLT_API_KEY_TEST: "", TANKVOLT_API_KEY: "bare-key" } as any, "TANKVOLT_API_KEY"), "bare-key");
});

test("Tankvolt assumes its test host only in test mode; production needs an explicit host", () => {
  // Test mode: the key alone is enough — the test host is the default.
  const testConnectors = createTrackerConnectors({ FLEXI_INTEGRATIONS_ENV: "test", TANKVOLT_API_KEY: "k" } as any);
  assert.ok(testConnectors.some((c) => c.provider === "tankvolt"), "tankvolt configured in test mode");

  // Production mode with only a key and no host: connector stays OFF (no silent test host).
  const prodNoHost = createTrackerConnectors({ FLEXI_INTEGRATIONS_ENV: "production", TANKVOLT_API_KEY: "k" } as any);
  assert.ok(!prodNoHost.some((c) => c.provider === "tankvolt"), "no silent test host in production");

  // Production mode with an explicit prod host: connector is ON.
  const prodWithHost = createTrackerConnectors({
    FLEXI_INTEGRATIONS_ENV: "production",
    TANKVOLT_API_KEY_PROD: "k",
    TANKVOLT_API_BASE_PROD: "https://prod.tankvolt.example"
  } as any);
  assert.ok(prodWithHost.some((c) => c.provider === "tankvolt"), "tankvolt on with explicit prod host");
});
