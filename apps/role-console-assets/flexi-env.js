// Resolves backend base URLs for every Fleximotion frontend.
// Local development talks to the well-known localhost ports; any other host
// assumes the nginx reverse-proxy layout described in deploy/linode/README.md,
// where each service is exposed under /services/<name> on the same origin.
window.flexiServiceBase = function flexiServiceBase(service, port) {
  const isLocal = ["127.0.0.1", "localhost", ""].includes(location.hostname);
  if (isLocal) return `http://127.0.0.1:${port}`;
  return `${location.origin}/services/${service}`;
};
