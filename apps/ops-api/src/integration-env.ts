// One switch picks test vs production credentials for every external
// integration (trackers, Speedaf, Monnify, …):
//
//   FLEXI_INTEGRATIONS_ENV = test (default) | production
//
// Resolution for a variable like TANKVOLT_API_KEY: prefer the mode-specific
// TANKVOLT_PROD_API_KEY / TANKVOLT_TEST_API_KEY; otherwise fall back to the
// bare TANKVOLT_API_KEY. So an existing single-value setup keeps working (it is
// treated as the current mode's value), and going live means adding only the
// *_PROD_* values that differ and flipping the flag — never re-entering what is
// already there.
export type IntegrationsMode = "test" | "production";

export function integrationsMode(env: NodeJS.ProcessEnv = process.env): IntegrationsMode {
  const raw = String(env.FLEXI_INTEGRATIONS_ENV || "test").toLowerCase();
  return ["production", "prod", "live"].includes(raw) ? "production" : "test";
}

// Resolve a credential var for the active mode, with fallback to the bare name.
// Empty strings are treated as unset so a blank override never masks the bare value.
export function integrationVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const prefix = integrationsMode(env) === "production" ? "PROD" : "TEST";
  const underscore = name.indexOf("_");
  const scoped = underscore === -1
    ? `${name}_${prefix}`
    : `${name.slice(0, underscore)}_${prefix}${name.slice(underscore)}`;
  const scopedVal = env[scoped];
  if (scopedVal !== undefined && scopedVal !== "") return scopedVal;
  const bare = env[name];
  return bare !== undefined && bare !== "" ? bare : undefined;
}
