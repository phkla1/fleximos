// Resolves backend base URLs for every Fleximotion frontend.
// Local development talks to the well-known localhost ports; any other host
// assumes the nginx reverse-proxy layout described in deploy/linode/README.md,
// where each service is exposed under /services/<name> on the same origin.
// Resolves the API bearer token. A ?token=... query value is remembered in
// localStorage so deployed testers only need the tokenised link once; local
// development falls back to the well-known dev token.
window.flexiServiceToken = function flexiServiceToken() {
  const fromQuery = new URLSearchParams(location.search).get("token");
  if (fromQuery) {
    try { localStorage.setItem("flexiServiceToken", fromQuery); } catch { /* private mode */ }
    return fromQuery;
  }
  let stored = null;
  try { stored = localStorage.getItem("flexiServiceToken"); } catch { /* private mode */ }
  return stored || "flexi-dev-service-token";
};

window.flexiServiceBase = function flexiServiceBase(service, port) {
  const isLocal = ["127.0.0.1", "localhost", ""].includes(location.hostname);
  if (isLocal) return `http://127.0.0.1:${port}`;
  return `${location.origin}/services/${service}`;
};
