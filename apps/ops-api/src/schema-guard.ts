import { createHash } from "node:crypto";

// Reusable import schema-guard (Phase D addition, Wole 5 Nov 2026). Any partner
// that hands us an Excel/CSV export can change its format without warning; this
// validates a parsed file against a declared contract BEFORE any row is ingested,
// so an unannounced change is caught and surfaced instead of silently corrupting
// data. It is source-agnostic — inDrive declares the first contract; Speedaf and
// future file sources reuse the same engine.
//
// It answers three things: (1) are the required sheets/columns present and of the
// right type? (2) do the source's invariants still hold — the checks a mere header
// rename wouldn't trip (e.g. inDrive's 13% commission)? (3) does the overall format
// fingerprint still match the last-known-good, catching changes we never wrote a
// rule for? Findings are structured and descriptive; the caller decides to block a
// commit, warn, and/or alert.

export type Severity = "block" | "warn" | "notice";
export type ColumnType = "date-serial" | "number" | "numeric-id" | "text";

export type ColumnSpec = {
  field: string;          // canonical name
  aliases: string[];      // normalised header spellings that map to it
  type: ColumnType;
  required?: boolean;
};

export type SheetSpec = {
  role: string;           // e.g. "weekly" | "orders" — the caller classifies to this
  label: string;          // human name for messages
  required?: boolean;
  columns: ColumnSpec[];
};

// What the caller observed after locating + classifying the workbook. A sheet is
// null when the caller could not find one for that role. `rows` holds a sample of
// typed values per role, for the invariants.
export type ObservedSheet = { role: string; headerKeys: string[] } | null;
export type Observed = {
  file?: string;
  sheets: Partial<Record<string, { headerKeys: string[] }>>; // by role
  rows?: Record<string, Array<Record<string, unknown>>>;     // by role
};

export type Finding = {
  severity: Severity;
  code: string;
  source: string;
  file?: string;
  sheet?: string;
  column?: string;
  expected?: string;
  found?: string;
  consequence: string;
  action: string;
  message: string;
};

export type Fingerprint = { version: number; hash: string; columns: Record<string, string[]>; updated_at?: string };

export type GuardResult = {
  source: string;
  blocked: boolean;
  findings: Finding[];
  fingerprint: Fingerprint;
  last_good_version: number | null;
};

export type SourceContract = {
  source: string;
  sheets: SheetSpec[];
  // Source-specific invariants over the sampled rows; returns findings (usually warn).
  invariants?: (rows: Record<string, Array<Record<string, unknown>>>, source: string, file?: string) => Finding[];
};

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[\s_]+/g, " ").trim();
}

// Cheap edit distance for a "closest header present" hint on a missing column.
function closest(target: string, candidates: string[]): string | null {
  const sortTokens = (s: string) => s.split(" ").filter(Boolean).sort().join(" ");
  const t = norm(target);
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const n = norm(c);
    // Compare both directly and token-sorted, so a word reorder
    // (income_courier → courier_income) still reads as the same column.
    const d = Math.min(editDistance(t, n), editDistance(sortTokens(t), sortTokens(n)));
    if (d < bestScore) { bestScore = d; best = c; }
  }
  // Only suggest when it is plausibly the same column (not a wild guess).
  return best !== null && bestScore <= Math.max(3, Math.ceil(t.length * 0.5)) ? best : null;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function columnPresent(spec: ColumnSpec, headerKeys: string[]): boolean {
  const names = [norm(spec.field), ...spec.aliases.map(norm)];
  return headerKeys.some((h) => names.some((n) => h === n || h.includes(n)));
}

// A value is "of type" when it plausibly parses as that type (tolerant: blanks skip).
function typeParses(type: ColumnType, value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (s === "") return true;
  if (type === "text") return true;
  // Dates arrive either as Excel serials or, once parsed, as ISO YYYY-MM-DD.
  if (type === "date-serial") {
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
    const d = Number(s);
    return Number.isFinite(d) && d > 20000 && d < 90000; // serials for ~2024–2126
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  if (type === "numeric-id") return n > 0;
  return true; // number
}

export function validateSource(contract: SourceContract, observed: Observed, lastGood?: Fingerprint | null): GuardResult {
  const findings: Finding[] = [];
  const file = observed.file;
  const fingerprintColumns: Record<string, string[]> = {};

  for (const sheet of contract.sheets) {
    const got = observed.sheets[sheet.role];
    if (!got) {
      if (sheet.required) {
        findings.push({
          severity: "block", code: "sheet_missing", source: contract.source, file, sheet: sheet.label,
          expected: `a sheet with ${sheet.columns.filter((c) => c.required).map((c) => c.field).join(", ")}`,
          found: "no matching sheet",
          consequence: sheet.role === "orders"
            ? "We derive per-day deliveries and distance from it; without it only weekly totals are available."
            : "The core data for this source lives on it; without it nothing can be imported.",
          action: "Confirm the new layout with the partner, then update the mapping.",
          message: `Sheet '${sheet.label}' is missing.`
        });
      }
      continue;
    }
    const matched: string[] = [];
    for (const col of sheet.columns) {
      const present = columnPresent(col, got.headerKeys);
      if (present) {
        matched.push(col.field);
        // Type check on a sample of values, if rows were provided.
        const sample = (observed.rows?.[sheet.role] || []).slice(0, 25);
        const bad = sample.filter((r) => r[col.field] !== undefined && !typeParses(col.type, r[col.field])).length;
        if (col.required && sample.length && bad > sample.length / 2) {
          findings.push({
            severity: "block", code: "column_type_changed", source: contract.source, file, sheet: sheet.label, column: col.field,
            expected: `${col.type} values`, found: `values that no longer parse as ${col.type}`,
            consequence: col.type === "date-serial"
              ? "Dates can no longer be read, so rows cannot be placed on a day."
              : "The column's values can no longer be read.",
            action: "Confirm the new format with the partner, then update the mapping.",
            message: `Column '${col.field}' on '${sheet.label}' is no longer a ${col.type}.`
          });
        }
      } else if (col.required) {
        const hint = closest(col.field, got.headerKeys);
        findings.push({
          severity: "block", code: "column_missing", source: contract.source, file, sheet: sheet.label, column: col.field,
          expected: `a '${col.field}' column`, found: hint ? `closest header present: '${hint}'` : "not found",
          consequence: col.field.includes("income") || col.field.includes("gmv")
            ? "We read each rider's earnings from this column; without it, earnings cannot be imported."
            : col.type === "date-serial"
              ? "We place each row on a day using this column; without it, rows cannot be dated."
              : "This column is required to attribute the row to a rider.",
          action: hint ? `If '${hint}' is the renamed column, update the mapping; otherwise confirm the new format with the partner.`
            : "Confirm the new format with the partner, then update the mapping.",
          message: `Column '${col.field}' not found${hint ? `. Closest header present: '${hint}'` : ""}.`
        });
      }
    }
    fingerprintColumns[sheet.role] = matched.sort();
  }

  if (contract.invariants && observed.rows) {
    findings.push(...contract.invariants(observed.rows, contract.source, file));
  }

  // Fingerprint: stable over the matched canonical columns per sheet role.
  const basis = Object.keys(fingerprintColumns).sort().map((role) => `${role}:${fingerprintColumns[role].join(",")}`).join("|");
  const hash = createHash("sha1").update(basis).digest("hex").slice(0, 16);
  const changed = lastGood && lastGood.hash && lastGood.hash !== hash;
  const version = changed ? (lastGood!.version || 0) + 1 : (lastGood?.version || 1);
  const fingerprint: Fingerprint = { version, hash, columns: fingerprintColumns };

  // Catch-all: the shape changed in a way no explicit rule tripped.
  const hasBlockOrWarn = findings.some((f) => f.severity !== "notice");
  if (changed && !hasBlockOrWarn) {
    findings.push({
      severity: "warn", code: "format_changed", source: contract.source, file,
      expected: `fingerprint ${lastGood!.hash} (v${lastGood!.version})`, found: `fingerprint ${hash} (unrecognised)`,
      consequence: "The file's columns changed in a way we did not anticipate; values may not mean what we expect.",
      action: "Review the file against the partner's last format, then confirm or update the mapping.",
      message: `${contract.source} export format changed — last good = v${lastGood!.version}, received = unrecognised.`
    });
  }

  return {
    source: contract.source,
    blocked: findings.some((f) => f.severity === "block"),
    findings,
    fingerprint,
    last_good_version: lastGood?.version ?? null
  };
}

/* ------------------------------ inDrive contract ------------------------------ */

export const INDRIVE_CONTRACT: SourceContract = {
  source: "inDrive",
  sheets: [
    {
      role: "weekly", label: "report", required: true,
      columns: [
        { field: "driver_id", aliases: ["driver id", "user id"], type: "numeric-id", required: true },
        { field: "week_start", aliases: ["week start"], type: "date-serial", required: true },
        { field: "week_end", aliases: ["week end"], type: "date-serial", required: true },
        { field: "gmv", aliases: ["gmv within period"], type: "number", required: true },
        { field: "dones", aliases: ["completed orders", "dones within period"], type: "number", required: true },
        { field: "income_courier", aliases: ["income courier", "income courier minus our commision"], type: "number", required: true }
      ]
    },
    {
      role: "orders", label: "orders_list", required: true,
      columns: [
        { field: "driver_id", aliases: ["driver id"], type: "numeric-id", required: true },
        { field: "order_uuid", aliases: ["order uuid", "order id"], type: "text", required: true },
        { field: "order_timestamp", aliases: ["order timestamp"], type: "date-serial", required: true },
        { field: "distance_km", aliases: ["distance km", "distance"], type: "number", required: true }
      ]
    }
  ],
  invariants(rows, source, file) {
    const out: Finding[] = [];
    const weekly = rows.weekly || [];
    const num = (v: unknown) => Number(String(v ?? "").trim());

    // Commission: income_courier should be ~87% of gmv (inDrive's 13% cut). A drift
    // may be a real rate change — it must be confirmed, never silently trusted.
    const ratios = weekly
      .map((r) => ({ g: num(r.gmv), i: num(r.income_courier) }))
      .filter((r) => Number.isFinite(r.g) && r.g > 0 && Number.isFinite(r.i) && r.i > 0)
      .map((r) => r.i / r.g);
    if (ratios.length) {
      ratios.sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      if (Math.abs(median - 0.87) > 0.02) {
        out.push({
          severity: "warn", code: "commission_drift", source, file, column: "income_courier",
          expected: "income_courier ≈ 87% of gmv (13% commission)",
          found: `income_courier is ${(median * 100).toFixed(1)}% of gmv`,
          consequence: `inDrive's cut may have moved from 13% to ${((1 - median) * 100).toFixed(0)}%. Earnings imported now are tagged estimated.`,
          action: "Confirm the commission rate with inDrive before trusting these earnings.",
          message: `Commission check: income_courier is ${(median * 100).toFixed(1)}% of gmv (expected 87%).`
        });
      }
    }

    // Week span should be a 7-day window (date_interval 6 → inclusive 7 days).
    const spans = weekly
      .map((r) => {
        const s = num(r.week_start), e = num(r.week_end);
        return Number.isFinite(s) && Number.isFinite(e) ? e - s : null;
      })
      .filter((d): d is number => d !== null);
    if (spans.length && !spans.every((d) => d === 6 || d === 7)) {
      out.push({
        severity: "warn", code: "week_span", source, file,
        expected: "a 7-day week (week_end − week_start = 6–7)",
        found: `spans of ${[...new Set(spans)].slice(0, 5).join(", ")} days`,
        consequence: "Allocation assumes a weekly bucket; a different span means money may be split over the wrong days.",
        action: "Confirm the reporting period with inDrive.",
        message: "Week span is no longer 7 days."
      });
    }

    // Non-negative money.
    if (weekly.some((r) => num(r.gmv) < 0 || num(r.income_courier) < 0)) {
      out.push({
        severity: "warn", code: "negative_money", source, file,
        expected: "non-negative gmv and income", found: "a negative money value",
        consequence: "Negative earnings would wrongly reduce a rider's recorded revenue.",
        action: "Check the file with inDrive before importing.",
        message: "A negative money value is present in the report."
      });
    }

    // Order distance in a sane range (deliveries, not inter-city).
    const orders = rows.orders || [];
    const distances = orders.map((r) => num(r.distance_km)).filter((d) => Number.isFinite(d));
    if (distances.length && distances.some((d) => d < 0 || d > 200)) {
      out.push({
        severity: "warn", code: "distance_range", source, file, column: "distance_km",
        expected: "per-order distance roughly 0–200 km", found: `values up to ${Math.max(...distances).toFixed(0)} km`,
        consequence: "An out-of-range distance suggests a unit change (e.g. metres vs km) or a column shift.",
        action: "Confirm the distance unit with inDrive.",
        message: "Order distance is outside the plausible range."
      });
    }
    return out;
  }
};

// A one-line, human banner for a set of findings — used in the dry-run summary.
export function summariseFindings(result: GuardResult): string {
  const blocks = result.findings.filter((f) => f.severity === "block").length;
  const warns = result.findings.filter((f) => f.severity === "warn").length;
  if (result.blocked) return `${result.source} export format changed — import held, nothing written (${blocks} blocking issue${blocks === 1 ? "" : "s"}).`;
  if (warns) return `${result.source} import allowed with ${warns} warning${warns === 1 ? "" : "s"} — review before trusting.`;
  return `${result.source} format matches the last known-good (v${result.fingerprint.version}).`;
}
