import fs from "node:fs/promises";
import path from "node:path";

const args = new Map(process.argv.slice(2).map((value, index, all) =>
  value.startsWith("--") ? [value.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1]] : [value, undefined]
).filter(([, value]) => value !== undefined));
const input = args.get("input");
const mappingPath = args.get("mapping");
const execute = args.has("execute");
const opsBase = process.env.OPS_API_BASE || "http://127.0.0.1:4030";
const token = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";

if (!input) {
  console.error("Usage: node scripts/migrate-ops-daily-csv.mjs --input daily.csv [--mapping mapping.json] [--execute]");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ""])));
}

const records = parseCsv(await fs.readFile(path.resolve(input), "utf8"));
const mapping = mappingPath ? JSON.parse(await fs.readFile(path.resolve(mappingPath), "utf8")) : {};
const required = ["record_date", "platform_account_id", "platform_operator_id"];
const failures = [];
const grouped = new Map();

records.forEach((row, index) => {
  const normalized = { ...row, ...(mapping[row.operator_name] || {}) };
  const missing = required.filter((field) => !normalized[field]);
  if (missing.length) {
    failures.push({ row: index + 2, operator_name: row.operator_name || null, missing });
    return;
  }
  const key = `${normalized.record_date}:${normalized.platform_account_id}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push({
    platform_operator_id: normalized.platform_operator_id,
    trips_total: Number(normalized.trips_total || 0),
    trips_completed: Number(normalized.trips_completed || 0),
    trips_cancelled: Number(normalized.trips_cancelled || 0),
    trips_no_response: Number(normalized.trips_no_response || 0),
    trips_rejected: Number(normalized.trips_rejected || 0),
    ride_revenue_ngn: Number(normalized.ride_revenue_ngn || 0),
    net_earnings_ngn: Number(normalized.net_earnings_ngn || 0),
    booking_fees_ngn: Number(normalized.booking_fees_ngn || 0),
    cash_trips: Number(normalized.cash_trips || 0),
    card_trips: Number(normalized.card_trips || 0),
    acceptance_pct: normalized.acceptance_pct === "" ? null : Number(normalized.acceptance_pct),
    cancellation_pct: normalized.cancellation_pct === "" ? null : Number(normalized.cancellation_pct),
    completion_pct: normalized.completion_pct === "" ? null : Number(normalized.completion_pct),
    hours_online: Number(normalized.hours_online || 0),
    official_distance_km: normalized.official_distance_km === "" ? null : Number(normalized.official_distance_km),
    current_status: normalized.current_status || "checked_out",
    data_quality: normalized.data_quality || "authoritative",
    provenance: { source_file: path.basename(input), migration_row: index + 2 }
  });
});

const summary = {
  mode: execute ? "execute" : "dry_run",
  source_rows: records.length,
  valid_rows: records.length - failures.length,
  rejected_rows: failures.length,
  ingestion_batches: grouped.size,
  failures
};

if (!execute) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failures.length ? 2 : 0);
}
if (failures.length) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(2);
}

const runs = [];
for (const [key, batch] of grouped) {
  const [recordDate, platformAccountId] = key.split(":");
  const response = await fetch(`${opsBase}/ops/v1/ingestion-runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `migration-${recordDate}-${platformAccountId}-${path.basename(input)}`.slice(0, 120)
    },
    body: JSON.stringify({
      platform_account_id: platformAccountId,
      record_date: recordDate,
      source: "migration",
      records: batch
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error?.message || `Migration failed: ${response.status}`);
  runs.push(body);
}
console.log(JSON.stringify({ ...summary, runs }, null, 2));
