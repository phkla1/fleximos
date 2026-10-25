// One switch picks test vs production credentials for every external
// integration (trackers, Speedaf, Monnify, …):
//
//   FLEXI_INTEGRATIONS_ENV = test (default) | production
//
// Resolution for a variable like TANKVOLT_API_KEY: prefer the mode-specific
// suffixed name — TANKVOLT_API_KEY_PROD / TANKVOLT_API_KEY_TEST (just append
// _TEST or _PROD to the end) — otherwise fall back to the bare TANKVOLT_API_KEY.
// So an existing single-value setup keeps working (it is treated as the current
// mode's value), and going live means adding only the *_PROD values that differ
// and flipping the flag — never re-entering what is already there.
export type IntegrationsMode = "test" | "production";

export function integrationsMode(env: NodeJS.ProcessEnv = process.env): IntegrationsMode {
  const raw = String(env.FLEXI_INTEGRATIONS_ENV || "test").toLowerCase();
  return ["production", "prod", "live"].includes(raw) ? "production" : "test";
}

// Resolve a credential var for the active mode, with fallback to the bare name.
// The per-mode name is just the variable with a `_TEST` / `_PROD` suffix.
// Empty strings are treated as unset so a blank override never masks the bare value.
export function integrationVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const suffix = integrationsMode(env) === "production" ? "_PROD" : "_TEST";
  const scopedVal = env[`${name}${suffix}`];
  if (scopedVal !== undefined && scopedVal !== "") return scopedVal;
  const bare = env[name];
  return bare !== undefined && bare !== "" ? bare : undefined;
}
