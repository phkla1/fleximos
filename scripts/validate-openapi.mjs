import fs from "node:fs/promises";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const contractDir = path.join(root, "api-contracts", "openapi");
const requiredFiles = [
  "identity.v1.json",
  "amoeba.v1.json",
  "ops.v1.json",
  "hr.v1.json",
  "tms.v1.json"
];

const mutationMethods = new Set(["post", "put", "patch", "delete"]);

function fail(message, failures) {
  failures.push(message);
}

function validateOperation(file, route, method, operation, failures) {
  if (!operation.summary) fail(`${file} ${method.toUpperCase()} ${route} is missing summary`, failures);
  if (!operation.responses || !Object.keys(operation.responses).length) {
    fail(`${file} ${method.toUpperCase()} ${route} is missing responses`, failures);
  }

  if (mutationMethods.has(method)) {
    const parameters = operation.parameters || [];
    const hasIdempotency = parameters.some((parameter) => {
      if (parameter.$ref) return parameter.$ref.endsWith("/IdempotencyKey");
      return parameter.name === "Idempotency-Key" && parameter.in === "header";
    });
    const isLogin = route.includes("/auth/login");
    if (!hasIdempotency && !isLogin) {
      fail(`${file} ${method.toUpperCase()} ${route} mutation is missing Idempotency-Key`, failures);
    }
  }
}

function validateContract(file, contract) {
  const failures = [];
  if (contract.openapi !== "3.1.0") fail(`${file} must use OpenAPI 3.1.0`, failures);
  if (!contract.info?.title) fail(`${file} is missing info.title`, failures);
  if (!contract.info?.version) fail(`${file} is missing info.version`, failures);
  if (!contract.components?.securitySchemes?.BearerAuth) {
    fail(`${file} is missing BearerAuth security scheme`, failures);
  }
  if (!contract.paths || !Object.keys(contract.paths).length) {
    fail(`${file} has no paths`, failures);
  }

  for (const [route, methods] of Object.entries(contract.paths || {})) {
    if (!route.startsWith("/")) fail(`${file} route ${route} must start with /`, failures);
    for (const [method, operation] of Object.entries(methods)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        validateOperation(file, route, method, operation, failures);
      }
    }
  }
  return failures;
}

const allFailures = [];

for (const file of requiredFiles) {
  const filePath = path.join(contractDir, file);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    allFailures.push(`${file} could not be read as JSON: ${error.message}`);
    continue;
  }
  allFailures.push(...validateContract(file, parsed));
}

if (allFailures.length) {
  console.error("OpenAPI validation failed:");
  for (const failure of allFailures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${requiredFiles.length} OpenAPI contracts.`);
