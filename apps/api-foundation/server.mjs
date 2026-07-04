import http from "node:http";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const port = Number(process.env.PORT || 4010);
const host = process.env.HOST || "127.0.0.1";
const serviceToken = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";
const dbDir = process.env.FLEXI_DB_DIR || path.resolve(".data/foundation-pglite");
const db = new PGlite(`file://${dbDir}`);

const allowedPersonStatuses = new Set(["active", "inactive", "suspended"]);
const allowedUserStatuses = new Set(["active", "inactive", "suspended"]);
const allowedAssignmentRoles = new Set(["manager", "finance", "supervisor", "operator"]);
const allowedScopeTypes = new Set(["company", "amoeba", "site", "team"]);
const allowedAssignmentStatuses = new Set(["active", "inactive"]);
const allowedAmoebaClassifications = new Set(["operating", "shared_services", "investment"]);
const allowedAmoebaStatuses = new Set(["active", "archived"]);
const allowedSiteStatuses = new Set(["active", "inactive"]);

function now() {
  return new Date().toISOString();
}

function prefixed(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function page(data) {
  return { data, next_cursor: null };
}

async function one(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

async function many(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

async function exec(sql, params = []) {
  return db.query(sql, params);
}

async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      person_id TEXT PRIMARY KEY,
      legal_name TEXT,
      display_name TEXT NOT NULL,
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      global_status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(person_id),
      roles JSONB NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_assignments (
      role_assignment_id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(person_id),
      role TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      created_by_person_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CHECK (
        (scope_type = 'company' AND scope_id IS NULL)
        OR (scope_type <> 'company' AND scope_id IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_role_assignments_person
      ON role_assignments(person_id, status, valid_from, valid_to);
    CREATE INDEX IF NOT EXISTS idx_role_assignments_scope
      ON role_assignments(role, scope_type, scope_id, status);

    CREATE TABLE IF NOT EXISTS service_accounts (
      service_account_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scopes JSONB NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_account_tokens (
      token_id TEXT PRIMARY KEY,
      service_account_id TEXT NOT NULL REFERENCES service_accounts(service_account_id),
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS amoebas (
      amoeba_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      classification TEXT NOT NULL,
      status TEXT NOT NULL,
      parent_amoeba_id TEXT REFERENCES amoebas(amoeba_id),
      coordinator_person_id TEXT REFERENCES people(person_id),
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS amoeba_sites (
      site_id TEXT PRIMARY KEY,
      amoeba_id TEXT NOT NULL REFERENCES amoebas(amoeba_id),
      name TEXT NOT NULL,
      gps_lat DOUBLE PRECISION,
      gps_lng DOUBLE PRECISION,
      alert_radius_m INTEGER NOT NULL DEFAULT 1000,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (amoeba_id, name)
    );

    CREATE TABLE IF NOT EXISTS audit_history (
      history_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL,
      actor_person_id TEXT,
      change_type TEXT NOT NULL,
      diff JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_history_entity
      ON audit_history(entity_type, entity_id, changed_at);

    CREATE TABLE IF NOT EXISTS idempotency_records (
      idempotency_key TEXT PRIMARY KEY,
      status INTEGER NOT NULL,
      body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  const seeded = await one("SELECT person_id FROM people WHERE person_id = $1", ["person_founder_wole"]);
  if (!seeded) await seedDb();
  await seedSites();
}

async function addHistory(entityType, entityId, actorPersonId, changeType, diff) {
  await exec(
    `INSERT INTO audit_history
      (history_id, entity_type, entity_id, changed_at, actor_person_id, change_type, diff)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [prefixed("hist"), entityType, entityId, now(), actorPersonId || "person_system", changeType, diff]
  );
}

async function seedDb() {
  const timestamp = now();
  const ownerPerson = {
    person_id: "person_founder_wole",
    legal_name: "Wole",
    display_name: "Wole",
    phone: "+2347033550173",
    email: "wole@fleximotion.online",
    global_status: "active",
    created_at: timestamp,
    updated_at: timestamp
  };
  const user = {
    user_id: "user_founder_wole",
    person_id: ownerPerson.person_id,
    roles: ["owner", "admin"],
    status: "active",
    created_at: timestamp,
    updated_at: timestamp
  };
  const serviceAccount = {
    service_account_id: "svc_foundation_dev",
    name: "Foundation Dev Service",
    scopes: ["identity:*", "amoeba:*"],
    status: "active",
    created_at: timestamp,
    updated_at: timestamp
  };

  await exec(
    `INSERT INTO people
      (person_id, legal_name, display_name, phone, email, global_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    Object.values(ownerPerson)
  );
  await addHistory("person", ownerPerson.person_id, ownerPerson.person_id, "seeded", ownerPerson);

  await exec(
    `INSERT INTO users (user_id, person_id, roles, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.user_id, user.person_id, user.roles, user.status, user.created_at, user.updated_at]
  );
  await addHistory("user", user.user_id, ownerPerson.person_id, "seeded", user);

  await exec(
    `INSERT INTO service_accounts
      (service_account_id, name, scopes, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      serviceAccount.service_account_id,
      serviceAccount.name,
      serviceAccount.scopes,
      serviceAccount.status,
      serviceAccount.created_at,
      serviceAccount.updated_at
    ]
  );

  for (const amoeba of [
    { amoeba_id: "amoeba_island", name: "Island", classification: "operating" },
    { amoeba_id: "amoeba_mainland", name: "Mainland", classification: "operating" },
    { amoeba_id: "amoeba_central", name: "Central", classification: "shared_services" }
  ]) {
    const record = {
      ...amoeba,
      status: "active",
      parent_amoeba_id: null,
      coordinator_person_id: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    await exec(
      `INSERT INTO amoebas
        (amoeba_id, name, classification, status, parent_amoeba_id, coordinator_person_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.amoeba_id,
        record.name,
        record.classification,
        record.status,
        record.parent_amoeba_id,
        record.coordinator_person_id,
        record.created_at,
        record.updated_at
      ]
    );
    await addHistory("amoeba", record.amoeba_id, ownerPerson.person_id, "seeded", record);
  }
}

async function seedSites() {
  const existing = await one("SELECT site_id FROM amoeba_sites LIMIT 1");
  if (existing) return;

  const timestamp = now();
  const sites = [
    {
      site_id: "site_island_1",
      amoeba_id: "amoeba_island",
      name: "Lekki Awudu Ekpegha",
      gps_lat: 6.44487546164212,
      gps_lng: 3.47798504327489,
      alert_radius_m: 500,
      is_primary: true
    },
    {
      site_id: "site_island_2",
      amoeba_id: "amoeba_island",
      name: "Lekki Olabanji Olajide",
      gps_lat: 6.43226684371674,
      gps_lng: 3.47199894037545,
      alert_radius_m: 500,
      is_primary: false
    },
    {
      site_id: "site_mainland_1",
      amoeba_id: "amoeba_mainland",
      name: "Ifako Ijaiye",
      gps_lat: 6.63418881933445,
      gps_lng: 3.32725882290423,
      alert_radius_m: 1000,
      is_primary: true
    },
    {
      site_id: "site_mainland_2",
      amoeba_id: "amoeba_mainland",
      name: "Anthony WABMA",
      gps_lat: 6.56214734154072,
      gps_lng: 3.36711174962463,
      alert_radius_m: 1000,
      is_primary: false
    }
  ];

  for (const site of sites) {
    const record = { ...site, status: "active", created_at: timestamp, updated_at: timestamp };
    await exec(
      `INSERT INTO amoeba_sites
        (site_id, amoeba_id, name, gps_lat, gps_lng, alert_radius_m, is_primary, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.site_id,
        record.amoeba_id,
        record.name,
        record.gps_lat,
        record.gps_lng,
        record.alert_radius_m,
        record.is_primary,
        record.status,
        record.created_at,
        record.updated_at
      ]
    );
    await addHistory("amoeba_site", record.site_id, "person_founder_wole", "seeded", record);
  }
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    ...headers
  });
  res.end(JSON.stringify(body, null, 2));
}

function error(res, status, code, message, details = []) {
  json(res, status, {
    error: {
      code,
      message,
      request_id: `req_${randomUUID().replaceAll("-", "").slice(0, 26)}`,
      details
    }
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function authIdentity(req) {
  const header = req.headers.authorization || "";
  if (header === `Bearer ${serviceToken}`) {
    return { kind: "service", actor_person_id: "person_system", scopes: ["identity:*", "amoeba:*"] };
  }
  if (header.startsWith("Bearer dev_access_")) {
    const userId = header.replace("Bearer dev_access_", "");
    const user = await one("SELECT * FROM users WHERE user_id = $1", [userId]);
    if (user) return { kind: "user", actor_person_id: user.person_id, user };
  }
  if (header.startsWith("Bearer flexi_sa_")) {
    const hashed = tokenHash(header.replace("Bearer ", ""));
    const tokenRecord = await one(
      `SELECT sat.*, sa.scopes, sa.status AS service_account_status
       FROM service_account_tokens sat
       JOIN service_accounts sa ON sa.service_account_id = sat.service_account_id
       WHERE sat.token_hash = $1`,
      [hashed]
    );
    if (tokenRecord?.status === "active" && tokenRecord.service_account_status === "active") {
      return {
        kind: "service_account",
        actor_person_id: "person_system",
        scopes: tokenRecord.scopes,
        account: { service_account_id: tokenRecord.service_account_id }
      };
    }
  }
  return null;
}

async function assertAuth(req, res) {
  const auth = await authIdentity(req);
  if (auth) return auth;
  error(res, 401, "unauthorized", "Missing or invalid bearer token.");
  return null;
}

function assertSystemAdmin(auth, res) {
  if (auth.kind === "service") return true;
  if (auth.kind === "service_account" && (auth.scopes || []).some((scope) => scope === "identity:*")) return true;
  if (auth.kind === "user" && (auth.user.roles || []).some((role) => role === "owner" || role === "admin")) return true;
  error(res, 403, "forbidden", "This action requires a system administrator.");
  return false;
}

async function assertIdempotency(req, res) {
  const key = req.headers["idempotency-key"];
  if (typeof key === "string" && key.length >= 8) return key;
  error(res, 400, "missing_idempotency_key", "Mutating requests require an Idempotency-Key header.");
  return null;
}

async function idempotentResponse(key) {
  return one("SELECT status, body FROM idempotency_records WHERE idempotency_key = $1", [key]);
}

async function onceForIdempotency(key, responseFactory) {
  const cached = await idempotentResponse(key);
  if (cached) return cached;
  const response = await responseFactory();
  await exec(
    "INSERT INTO idempotency_records (idempotency_key, status, body, created_at) VALUES ($1, $2, $3, $4)",
    [key, response.status, response.body, now()]
  );
  return response;
}

function pathParts(req) {
  return new URL(req.url, `http://${req.headers.host}`).pathname.split("/").filter(Boolean);
}

async function findPersonByPhoneOrEmail(phone, email, exceptPersonId = null) {
  if (!phone && !email) return null;
  return one(
    `SELECT * FROM people
     WHERE person_id <> COALESCE($1, '')
       AND (($2::text IS NOT NULL AND phone = $2) OR ($3::text IS NOT NULL AND email = $3))
     LIMIT 1`,
    [exceptPersonId, phone || null, email || null]
  );
}

function validatePersonInput(body, partial = false) {
  const details = [];
  if (!partial && !body.display_name) details.push({ field: "display_name", reason: "required" });
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) details.push({ field: "email", reason: "invalid_email" });
  if (body.global_status && !allowedPersonStatuses.has(body.global_status)) {
    details.push({ field: "global_status", reason: "invalid_status" });
  }
  return details;
}

async function validateAmoebaInput(body, partial = false) {
  const details = [];
  if (!partial && !body.name) details.push({ field: "name", reason: "required" });
  if (!partial && !body.classification) details.push({ field: "classification", reason: "required" });
  if (body.classification && !allowedAmoebaClassifications.has(body.classification)) {
    details.push({ field: "classification", reason: "invalid_classification" });
  }
  if (body.status && !allowedAmoebaStatuses.has(body.status)) details.push({ field: "status", reason: "invalid_status" });
  if (body.parent_amoeba_id && !(await one("SELECT amoeba_id FROM amoebas WHERE amoeba_id = $1", [body.parent_amoeba_id]))) {
    details.push({ field: "parent_amoeba_id", reason: "not_found" });
  }
  if (body.coordinator_person_id && !(await one("SELECT person_id FROM people WHERE person_id = $1", [body.coordinator_person_id]))) {
    details.push({ field: "coordinator_person_id", reason: "not_found" });
  }
  return details;
}

async function validateSiteInput(body, partial = false) {
  const details = [];
  if (!partial && !body.amoeba_id) details.push({ field: "amoeba_id", reason: "required" });
  if (!partial && !body.name) details.push({ field: "name", reason: "required" });
  if (body.amoeba_id && !(await one("SELECT amoeba_id FROM amoebas WHERE amoeba_id = $1", [body.amoeba_id]))) {
    details.push({ field: "amoeba_id", reason: "not_found" });
  }
  if (body.gps_lat !== undefined && body.gps_lat !== null && (Number(body.gps_lat) < -90 || Number(body.gps_lat) > 90 || Number.isNaN(Number(body.gps_lat)))) {
    details.push({ field: "gps_lat", reason: "invalid_latitude" });
  }
  if (body.gps_lng !== undefined && body.gps_lng !== null && (Number(body.gps_lng) < -180 || Number(body.gps_lng) > 180 || Number.isNaN(Number(body.gps_lng)))) {
    details.push({ field: "gps_lng", reason: "invalid_longitude" });
  }
  if (body.alert_radius_m !== undefined && (!Number.isInteger(Number(body.alert_radius_m)) || Number(body.alert_radius_m) < 1)) {
    details.push({ field: "alert_radius_m", reason: "invalid_radius" });
  }
  if (body.status && !allowedSiteStatuses.has(body.status)) details.push({ field: "status", reason: "invalid_status" });
  return details;
}

async function historyPage(entityType, entityId) {
  return page(
    await many(
      `SELECT changed_at, actor_person_id, change_type, diff
       FROM audit_history
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY changed_at ASC`,
      [entityType, entityId]
    )
  );
}

async function activeRoleAssignments(personId) {
  return many(
    `SELECT * FROM role_assignments
     WHERE person_id=$1 AND status='active'
       AND valid_from <= NOW()
       AND (valid_to IS NULL OR valid_to > NOW())
     ORDER BY role, scope_type, scope_id`,
    [personId]
  );
}

async function validateRoleAssignment(body, partial = false) {
  const details = [];
  if (!partial && !body.person_id) details.push({ field: "person_id", reason: "required" });
  if (!partial && !body.role) details.push({ field: "role", reason: "required" });
  if (!partial && !body.scope_type) details.push({ field: "scope_type", reason: "required" });
  if (body.person_id && !(await one("SELECT person_id FROM people WHERE person_id=$1", [body.person_id]))) {
    details.push({ field: "person_id", reason: "not_found" });
  }
  if (body.role && !allowedAssignmentRoles.has(body.role)) details.push({ field: "role", reason: "invalid_role" });
  if (body.scope_type && !allowedScopeTypes.has(body.scope_type)) details.push({ field: "scope_type", reason: "invalid_scope_type" });
  if (body.status && !allowedAssignmentStatuses.has(body.status)) details.push({ field: "status", reason: "invalid_status" });
  if (body.scope_type === "company" && body.scope_id) details.push({ field: "scope_id", reason: "must_be_empty_for_company" });
  if (body.scope_type && body.scope_type !== "company" && !body.scope_id) details.push({ field: "scope_id", reason: "required" });
  if (body.scope_type === "amoeba" && body.scope_id && !(await one("SELECT amoeba_id FROM amoebas WHERE amoeba_id=$1", [body.scope_id]))) {
    details.push({ field: "scope_id", reason: "amoeba_not_found" });
  }
  if (body.scope_type === "site" && body.scope_id && !(await one("SELECT site_id FROM amoeba_sites WHERE site_id=$1", [body.scope_id]))) {
    details.push({ field: "scope_id", reason: "site_not_found" });
  }
  if (body.valid_to && body.valid_from && new Date(body.valid_to) <= new Date(body.valid_from)) {
    details.push({ field: "valid_to", reason: "must_follow_valid_from" });
  }
  return details;
}

async function handleIdentity(req, res, parts) {
  const [, version, resource, id, action, tokenId] = parts;
  if (version !== "v1") return error(res, 404, "not_found", "Unsupported Identity API version.");

  if (resource === "auth" && id === "login" && req.method === "POST") {
    const body = await readBody(req);
    const user = await one(
      `SELECT u.*
       FROM users u
       JOIN people p ON p.person_id = u.person_id
       WHERE p.phone = $1 OR p.email = $1
       LIMIT 1`,
      [body.phone_or_email]
    );
    if (!user || body.pin !== "000000") return error(res, 401, "invalid_login", "Invalid login credentials.");
    return json(res, 200, {
      access_token: `dev_access_${user.user_id}`,
      refresh_token: `dev_refresh_${user.user_id}`,
      expires_in: 900
    });
  }

  const auth = await assertAuth(req, res);
  if (!auth) return;

  if (resource === "people" && !id && req.method === "GET") {
    return json(res, 200, page(await many("SELECT * FROM people ORDER BY created_at ASC")));
  }

  if (resource === "people" && !id && req.method === "POST") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const details = validatePersonInput(body);
    if (details.length) return error(res, 400, "validation_failed", "Person request is invalid.", details);
    if (await findPersonByPhoneOrEmail(body.phone, body.email)) {
      return error(res, 409, "duplicate_person", "A person with this phone or email already exists.");
    }
    const response = await onceForIdempotency(key, async () => {
      const timestamp = now();
      const person = {
        person_id: prefixed("person"),
        legal_name: body.legal_name || body.display_name,
        display_name: body.display_name,
        phone: body.phone || null,
        email: body.email || null,
        global_status: body.global_status || "active",
        created_at: timestamp,
        updated_at: timestamp
      };
      await exec(
        `INSERT INTO people
          (person_id, legal_name, display_name, phone, email, global_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          person.person_id,
          person.legal_name,
          person.display_name,
          person.phone,
          person.email,
          person.global_status,
          person.created_at,
          person.updated_at
        ]
      );
      await addHistory("person", person.person_id, auth.actor_person_id, "created", person);
      return { status: 201, body: person };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "people" && id && action === "history" && req.method === "GET") {
    if (!(await one("SELECT person_id FROM people WHERE person_id = $1", [id]))) return error(res, 404, "not_found", "Person not found.");
    return json(res, 200, await historyPage("person", id));
  }

  if (resource === "people" && id && !action && req.method === "GET") {
    const person = await one("SELECT * FROM people WHERE person_id = $1", [id]);
    return person ? json(res, 200, person) : error(res, 404, "not_found", "Person not found.");
  }

  if (resource === "people" && id && !action && req.method === "PATCH") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const person = await one("SELECT * FROM people WHERE person_id = $1", [id]);
    if (!person) return error(res, 404, "not_found", "Person not found.");
    const details = validatePersonInput(body, true);
    if (details.length) return error(res, 400, "validation_failed", "Person update is invalid.", details);
    if (await findPersonByPhoneOrEmail(body.phone, body.email, id)) {
      return error(res, 409, "duplicate_person", "A person with this phone or email already exists.");
    }
    const response = await onceForIdempotency(key, async () => {
      const updated = { ...person, ...body, updated_at: now() };
      await exec(
        `UPDATE people SET
          legal_name = $2,
          display_name = $3,
          phone = $4,
          email = $5,
          global_status = $6,
          updated_at = $7
         WHERE person_id = $1`,
        [id, updated.legal_name, updated.display_name, updated.phone, updated.email, updated.global_status, updated.updated_at]
      );
      await addHistory("person", id, auth.actor_person_id, "updated", body);
      return { status: 200, body: updated };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "users" && !id && req.method === "GET") return json(res, 200, page(await many("SELECT * FROM users ORDER BY created_at ASC")));

  if (resource === "users" && !id && req.method === "POST") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    if (!(await one("SELECT person_id FROM people WHERE person_id = $1", [body.person_id]))) {
      return error(res, 400, "validation_failed", "person_id must reference an existing person.");
    }
    const response = await onceForIdempotency(key, async () => {
      const timestamp = now();
      const user = {
        user_id: prefixed("user"),
        person_id: body.person_id,
        roles: body.roles || [],
        status: body.status || "active",
        created_at: timestamp,
        updated_at: timestamp
      };
      await exec("INSERT INTO users (user_id, person_id, roles, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)", [
        user.user_id,
        user.person_id,
        user.roles,
        user.status,
        user.created_at,
        user.updated_at
      ]);
      await addHistory("user", user.user_id, auth.actor_person_id, "created", user);
      return { status: 201, body: user };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "users" && id && action === "history" && req.method === "GET") {
    if (!(await one("SELECT user_id FROM users WHERE user_id = $1", [id]))) return error(res, 404, "not_found", "User not found.");
    return json(res, 200, await historyPage("user", id));
  }

  if (resource === "users" && id && !action && req.method === "GET") {
    const user = await one("SELECT * FROM users WHERE user_id = $1", [id]);
    return user ? json(res, 200, user) : error(res, 404, "not_found", "User not found.");
  }

  if (resource === "users" && id && !action && req.method === "PATCH") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const user = await one("SELECT * FROM users WHERE user_id = $1", [id]);
    if (!user) return error(res, 404, "not_found", "User not found.");
    if (body.status && !allowedUserStatuses.has(body.status)) {
      return error(res, 400, "validation_failed", "User status is invalid.", [{ field: "status", reason: "invalid_status" }]);
    }
    const response = await onceForIdempotency(key, async () => {
      const updated = { ...user, ...body, updated_at: now() };
      await exec("UPDATE users SET roles = $2, status = $3, updated_at = $4 WHERE user_id = $1", [
        id,
        updated.roles,
        updated.status,
        updated.updated_at
      ]);
      await addHistory("user", id, auth.actor_person_id, "updated", body);
      return { status: 200, body: updated };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "role-assignments" && !id && req.method === "GET") {
    if (!assertSystemAdmin(auth, res)) return;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const personId = url.searchParams.get("person_id");
    const role = url.searchParams.get("role");
    const clauses = [];
    const params = [];
    if (personId) {
      params.push(personId);
      clauses.push(`ra.person_id=$${params.length}`);
    }
    if (role) {
      params.push(role);
      clauses.push(`ra.role=$${params.length}`);
    }
    const rows = await many(
      `SELECT ra.*, p.display_name
       FROM role_assignments ra
       JOIN people p ON p.person_id=ra.person_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY ra.created_at ASC`,
      params
    );
    return json(res, 200, page(rows));
  }

  if (resource === "role-assignments" && !id && req.method === "POST") {
    if (!assertSystemAdmin(auth, res)) return;
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const details = await validateRoleAssignment(body);
    if (details.length) return error(res, 400, "validation_failed", "Role assignment request is invalid.", details);
    const existing = await one(
      `SELECT role_assignment_id FROM role_assignments
       WHERE person_id=$1 AND role=$2 AND scope_type=$3
         AND COALESCE(scope_id,'')=COALESCE($4,'') AND status='active'`,
      [body.person_id, body.role, body.scope_type, body.scope_id || null]
    );
    if (existing) return error(res, 409, "duplicate_assignment", "This active role assignment already exists.");
    const response = await onceForIdempotency(key, async () => {
      const timestamp = now();
      const assignment = {
        role_assignment_id: prefixed("roleasg"),
        person_id: body.person_id,
        role: body.role,
        scope_type: body.scope_type,
        scope_id: body.scope_type === "company" ? null : body.scope_id,
        status: body.status || "active",
        valid_from: body.valid_from || timestamp,
        valid_to: body.valid_to || null,
        created_by_person_id: auth.actor_person_id,
        created_at: timestamp,
        updated_at: timestamp
      };
      await exec(
        `INSERT INTO role_assignments
         (role_assignment_id, person_id, role, scope_type, scope_id, status,
          valid_from, valid_to, created_by_person_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        Object.values(assignment)
      );
      await addHistory("role_assignment", assignment.role_assignment_id, auth.actor_person_id, "created", assignment);
      return { status: 201, body: assignment };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "role-assignments" && id && action === "history" && req.method === "GET") {
    if (!assertSystemAdmin(auth, res)) return;
    if (!(await one("SELECT role_assignment_id FROM role_assignments WHERE role_assignment_id=$1", [id]))) {
      return error(res, 404, "not_found", "Role assignment not found.");
    }
    return json(res, 200, await historyPage("role_assignment", id));
  }

  if (resource === "role-assignments" && id && !action && req.method === "PATCH") {
    if (!assertSystemAdmin(auth, res)) return;
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const assignment = await one("SELECT * FROM role_assignments WHERE role_assignment_id=$1", [id]);
    if (!assignment) return error(res, 404, "not_found", "Role assignment not found.");
    const body = await readBody(req);
    const candidate = { ...assignment, ...body };
    const details = await validateRoleAssignment(candidate, true);
    if (details.length) return error(res, 400, "validation_failed", "Role assignment update is invalid.", details);
    const response = await onceForIdempotency(key, async () => {
      const updated = {
        ...candidate,
        scope_id: candidate.scope_type === "company" ? null : candidate.scope_id,
        updated_at: now()
      };
      await exec(
        `UPDATE role_assignments SET role=$2, scope_type=$3, scope_id=$4,
         status=$5, valid_from=$6, valid_to=$7, updated_at=$8
         WHERE role_assignment_id=$1`,
        [id, updated.role, updated.scope_type, updated.scope_id, updated.status,
         updated.valid_from, updated.valid_to, updated.updated_at]
      );
      await addHistory("role_assignment", id, auth.actor_person_id, "updated", body);
      return { status: 200, body: updated };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "me" && req.method === "GET") {
    if (auth.user) {
      const person = await one("SELECT * FROM people WHERE person_id = $1", [auth.user.person_id]);
      const roleAssignments = await activeRoleAssignments(auth.user.person_id);
      return json(res, 200, {
        actor_type: "human",
        person_id: auth.user.person_id,
        user_id: auth.user.user_id,
        roles: auth.user.roles,
        role_assignments: roleAssignments,
        status: auth.user.status,
        person
      });
    }
    return json(res, 200, {
      actor_type: "service",
      person_id: auth.actor_person_id,
      service_account_id: auth.account?.service_account_id || "foundation_service_token",
      service_account: auth.account?.service_account_id || "foundation_service_token",
      scopes: auth.scopes || []
    });
  }

  if (resource === "service-accounts" && !id && req.method === "GET") {
    return json(res, 200, page(await many("SELECT * FROM service_accounts ORDER BY created_at ASC")));
  }

  if (resource === "service-accounts" && !id && req.method === "POST") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    if (!body.name || !Array.isArray(body.scopes)) return error(res, 400, "validation_failed", "name and scopes are required.");
    const response = await onceForIdempotency(key, async () => {
      const timestamp = now();
      const account = {
        service_account_id: prefixed("svc"),
        name: body.name,
        scopes: body.scopes,
        status: "active",
        created_at: timestamp,
        updated_at: timestamp
      };
      await exec(
        "INSERT INTO service_accounts (service_account_id, name, scopes, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [account.service_account_id, account.name, account.scopes, account.status, account.created_at, account.updated_at]
      );
      return { status: 201, body: account };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "service-accounts" && id && action === "tokens" && !tokenId && req.method === "POST") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    if (!(await one("SELECT service_account_id FROM service_accounts WHERE service_account_id = $1", [id]))) {
      return error(res, 404, "not_found", "Service account not found.");
    }
    const response = await onceForIdempotency(key, async () => {
      const rawToken = `flexi_sa_${randomBytes(24).toString("hex")}`;
      const token = {
        token_id: prefixed("sat"),
        service_account_id: id,
        token_hash: tokenHash(rawToken),
        status: "active",
        created_at: now(),
        revoked_at: null
      };
      await exec(
        "INSERT INTO service_account_tokens (token_id, service_account_id, token_hash, status, created_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [token.token_id, token.service_account_id, token.token_hash, token.status, token.created_at, token.revoked_at]
      );
      return {
        status: 201,
        body: { token_id: token.token_id, service_account_id: id, token: rawToken, status: token.status, created_at: token.created_at }
      };
    });
    return json(res, response.status, response.body);
  }

  if (resource === "service-accounts" && id && action === "tokens" && tokenId && req.method === "DELETE") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const token = await one("SELECT * FROM service_account_tokens WHERE token_id = $1 AND service_account_id = $2", [tokenId, id]);
    if (!token) return error(res, 404, "not_found", "Service account token not found.");
    const response = await onceForIdempotency(key, async () => {
      await exec("UPDATE service_account_tokens SET status = $2, revoked_at = $3 WHERE token_id = $1", [tokenId, "revoked", now()]);
      return { status: 200, body: { token_id: tokenId, status: "revoked" } };
    });
    return json(res, response.status, response.body);
  }

  return error(res, 404, "not_found", "Identity route not found.");
}

async function handleAmoeba(req, res, parts) {
  const [, version, resource, id, action] = parts;
  if (version !== "v1" || !["amoebas", "sites"].includes(resource)) {
    return error(res, 404, "not_found", "Unsupported Amoeba API route.");
  }
  const auth = await assertAuth(req, res);
  if (!auth) return;

  if (resource === "sites") {
    if (!id && req.method === "GET") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const amoebaId = url.searchParams.get("amoeba_id");
      const rows = amoebaId
        ? await many("SELECT * FROM amoeba_sites WHERE amoeba_id = $1 ORDER BY created_at ASC", [amoebaId])
        : await many("SELECT * FROM amoeba_sites ORDER BY created_at ASC");
      return json(res, 200, page(rows));
    }

    if (!id && req.method === "POST") {
      const key = await assertIdempotency(req, res);
      if (!key) return;
      const cached = await idempotentResponse(key);
      if (cached) return json(res, cached.status, cached.body);
      const body = await readBody(req);
      const details = await validateSiteInput(body);
      if (details.length) return error(res, 400, "validation_failed", "Site request is invalid.", details);
      if (await one("SELECT site_id FROM amoeba_sites WHERE amoeba_id = $1 AND lower(name) = lower($2)", [body.amoeba_id, body.name])) {
        return error(res, 409, "duplicate_site", "A site with this name already exists for this amoeba.");
      }
      const response = await onceForIdempotency(key, async () => {
        const timestamp = now();
        const site = {
          site_id: prefixed("site"),
          amoeba_id: body.amoeba_id,
          name: body.name,
          gps_lat: body.gps_lat === undefined || body.gps_lat === "" ? null : Number(body.gps_lat),
          gps_lng: body.gps_lng === undefined || body.gps_lng === "" ? null : Number(body.gps_lng),
          alert_radius_m: body.alert_radius_m === undefined || body.alert_radius_m === "" ? 1000 : Number(body.alert_radius_m),
          is_primary: Boolean(body.is_primary),
          status: body.status || "active",
          created_at: timestamp,
          updated_at: timestamp
        };
        await exec(
          `INSERT INTO amoeba_sites
            (site_id, amoeba_id, name, gps_lat, gps_lng, alert_radius_m, is_primary, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            site.site_id,
            site.amoeba_id,
            site.name,
            site.gps_lat,
            site.gps_lng,
            site.alert_radius_m,
            site.is_primary,
            site.status,
            site.created_at,
            site.updated_at
          ]
        );
        await addHistory("amoeba_site", site.site_id, auth.actor_person_id, "created", site);
        return { status: 201, body: site };
      });
      return json(res, response.status, response.body);
    }

    if (id && action === "history" && req.method === "GET") {
      if (!(await one("SELECT site_id FROM amoeba_sites WHERE site_id = $1", [id]))) return error(res, 404, "not_found", "Site not found.");
      return json(res, 200, await historyPage("amoeba_site", id));
    }

    const site = id ? await one("SELECT * FROM amoeba_sites WHERE site_id = $1", [id]) : null;
    if (id && !site) return error(res, 404, "not_found", "Site not found.");

    if (id && !action && req.method === "GET") return json(res, 200, site);

    if (id && !action && req.method === "PATCH") {
      const key = await assertIdempotency(req, res);
      if (!key) return;
      const cached = await idempotentResponse(key);
      if (cached) return json(res, cached.status, cached.body);
      const body = await readBody(req);
      const details = await validateSiteInput(body, true);
      if (details.length) return error(res, 400, "validation_failed", "Site update is invalid.", details);
      const nextAmoebaId = body.amoeba_id || site.amoeba_id;
      const nextName = body.name || site.name;
      if (await one("SELECT site_id FROM amoeba_sites WHERE amoeba_id = $1 AND lower(name) = lower($2) AND site_id <> $3", [nextAmoebaId, nextName, id])) {
        return error(res, 409, "duplicate_site", "A site with this name already exists for this amoeba.");
      }
      const response = await onceForIdempotency(key, async () => {
        const updated = {
          ...site,
          ...body,
          gps_lat: body.gps_lat === undefined || body.gps_lat === "" ? site.gps_lat : Number(body.gps_lat),
          gps_lng: body.gps_lng === undefined || body.gps_lng === "" ? site.gps_lng : Number(body.gps_lng),
          alert_radius_m: body.alert_radius_m === undefined || body.alert_radius_m === "" ? site.alert_radius_m : Number(body.alert_radius_m),
          is_primary: body.is_primary === undefined ? site.is_primary : Boolean(body.is_primary),
          updated_at: now()
        };
        await exec(
          `UPDATE amoeba_sites SET
            amoeba_id = $2,
            name = $3,
            gps_lat = $4,
            gps_lng = $5,
            alert_radius_m = $6,
            is_primary = $7,
            status = $8,
            updated_at = $9
           WHERE site_id = $1`,
          [
            id,
            updated.amoeba_id,
            updated.name,
            updated.gps_lat,
            updated.gps_lng,
            updated.alert_radius_m,
            updated.is_primary,
            updated.status,
            updated.updated_at
          ]
        );
        await addHistory("amoeba_site", id, auth.actor_person_id, "updated", body);
        return { status: 200, body: updated };
      });
      return json(res, response.status, response.body);
    }

    return error(res, 404, "not_found", "Site route not found.");
  }

  if (!id && req.method === "GET") return json(res, 200, page(await many("SELECT * FROM amoebas ORDER BY created_at ASC")));

  if (!id && req.method === "POST") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const details = await validateAmoebaInput(body);
    if (details.length) return error(res, 400, "validation_failed", "Amoeba request is invalid.", details);
    if (await one("SELECT amoeba_id FROM amoebas WHERE lower(name) = lower($1)", [body.name])) {
      return error(res, 409, "duplicate_amoeba", "An amoeba with this name already exists.");
    }
    const response = await onceForIdempotency(key, async () => {
      const timestamp = now();
      const amoeba = {
        amoeba_id: prefixed("amoeba"),
        name: body.name,
        classification: body.classification,
        status: "active",
        parent_amoeba_id: body.parent_amoeba_id || null,
        coordinator_person_id: body.coordinator_person_id || null,
        created_at: timestamp,
        updated_at: timestamp
      };
      await exec(
        `INSERT INTO amoebas
          (amoeba_id, name, classification, status, parent_amoeba_id, coordinator_person_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          amoeba.amoeba_id,
          amoeba.name,
          amoeba.classification,
          amoeba.status,
          amoeba.parent_amoeba_id,
          amoeba.coordinator_person_id,
          amoeba.created_at,
          amoeba.updated_at
        ]
      );
      await addHistory("amoeba", amoeba.amoeba_id, auth.actor_person_id, "created", amoeba);
      return { status: 201, body: amoeba };
    });
    return json(res, response.status, response.body);
  }

  const amoeba = await one("SELECT * FROM amoebas WHERE amoeba_id = $1", [id]);
  if (!amoeba) return error(res, 404, "not_found", "Amoeba not found.");

  if (!action && req.method === "GET") return json(res, 200, amoeba);

  if (!action && req.method === "PATCH") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const details = await validateAmoebaInput(body, true);
    if (details.length) return error(res, 400, "validation_failed", "Amoeba update is invalid.", details);
    if (body.name && (await one("SELECT amoeba_id FROM amoebas WHERE lower(name) = lower($1) AND amoeba_id <> $2", [body.name, id]))) {
      return error(res, 409, "duplicate_amoeba", "An amoeba with this name already exists.");
    }
    const response = await onceForIdempotency(key, async () => {
      const updated = { ...amoeba, ...body, updated_at: now() };
      await exec(
        `UPDATE amoebas SET
          name = $2,
          classification = $3,
          status = $4,
          parent_amoeba_id = $5,
          coordinator_person_id = $6,
          updated_at = $7
         WHERE amoeba_id = $1`,
        [
          id,
          updated.name,
          updated.classification,
          updated.status,
          updated.parent_amoeba_id,
          updated.coordinator_person_id,
          updated.updated_at
        ]
      );
      await addHistory("amoeba", id, auth.actor_person_id, "updated", body);
      return { status: 200, body: updated };
    });
    return json(res, response.status, response.body);
  }

  if (action === "classify" && req.method === "POST") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const details = await validateAmoebaInput({ classification: body.classification }, true);
    if (!body.reason) details.push({ field: "reason", reason: "required" });
    if (details.length) return error(res, 400, "validation_failed", "Amoeba classification request is invalid.", details);
    const response = await onceForIdempotency(key, async () => {
      const updated = { ...amoeba, classification: body.classification, updated_at: now() };
      await exec("UPDATE amoebas SET classification = $2, updated_at = $3 WHERE amoeba_id = $1", [id, updated.classification, updated.updated_at]);
      await addHistory("amoeba", id, auth.actor_person_id, "classification_changed", { classification: body.classification, reason: body.reason });
      return { status: 200, body: updated };
    });
    return json(res, response.status, response.body);
  }

  if (action === "assign-coordinator" && req.method === "POST") {
    const key = await assertIdempotency(req, res);
    if (!key) return;
    const cached = await idempotentResponse(key);
    if (cached) return json(res, cached.status, cached.body);
    const body = await readBody(req);
    const details = await validateAmoebaInput({ coordinator_person_id: body.coordinator_person_id }, true);
    if (!body.coordinator_person_id) details.push({ field: "coordinator_person_id", reason: "required" });
    if (details.length) return error(res, 400, "validation_failed", "Coordinator assignment request is invalid.", details);
    const response = await onceForIdempotency(key, async () => {
      const updated = { ...amoeba, coordinator_person_id: body.coordinator_person_id, updated_at: now() };
      await exec("UPDATE amoebas SET coordinator_person_id = $2, updated_at = $3 WHERE amoeba_id = $1", [id, updated.coordinator_person_id, updated.updated_at]);
      await addHistory("amoeba", id, auth.actor_person_id, "coordinator_assigned", { coordinator_person_id: body.coordinator_person_id });
      return { status: 200, body: updated };
    });
    return json(res, response.status, response.body);
  }

  if (action === "history" && req.method === "GET") return json(res, 200, await historyPage("amoeba", id));

  return error(res, 404, "not_found", "Amoeba route not found.");
}

await initDb();

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    const parts = pathParts(req);
    if (parts.length === 0) {
      return json(res, 200, {
        name: "Fleximotion Identity/Amoeba Foundation API",
        status: "ok",
        version: "v1",
        database: "PGlite/PostgreSQL",
        auth: { type: "Bearer", development_token: serviceToken },
        links: {
          health: "/health",
          people: "/identity/v1/people",
          users: "/identity/v1/users",
          service_accounts: "/identity/v1/service-accounts",
          amoebas: "/amoeba/v1/amoebas",
          sites: "/amoeba/v1/sites",
          admin_console: "http://127.0.0.1:4173/apps/admin-console/",
          developer_portal: "http://127.0.0.1:4173/apps/developer-portal/"
        },
        examples: [
          {
            label: "List amoebas",
            method: "GET",
            path: "/amoeba/v1/amoebas",
            curl: `curl -H 'Authorization: Bearer ${serviceToken}' http://127.0.0.1:${port}/amoeba/v1/amoebas`
          },
          {
            label: "List people",
            method: "GET",
            path: "/identity/v1/people",
            curl: `curl -H 'Authorization: Bearer ${serviceToken}' http://127.0.0.1:${port}/identity/v1/people`
          }
        ]
      });
    }
    if (parts[0] === "health") return json(res, 200, { status: "ok", service: "api-foundation", database: "PGlite/PostgreSQL" });
    if (parts[0] === "identity") return handleIdentity(req, res, parts);
    if (parts[0] === "amoeba") return handleAmoeba(req, res, parts);
    return error(res, 404, "not_found", "Route not found.");
  } catch (err) {
    return error(res, 500, "internal_error", err.message);
  }
});

server.listen(port, host, () => {
  console.log(`Foundation API: http://${host}:${port}`);
});
