/*
 * One-time geocoder for the Flexicare facilities sheet (Phase F).
 *
 * The HR sheet carries free-text Lagos addresses but no coordinates. This script
 * geocodes each facility once, offline, so the coordinates are baked into the data
 * and the ops-api never has to call a geocoder at runtime.
 *
 * Strategy (as decided): street-level geocode via OSM Nominatim, with an LGA
 * (City column) centroid fallback when the exact address does not resolve. Every
 * result is tagged: coords_quality = "street" | "lga_centroid" | "failed".
 *
 * Fair use: Nominatim allows at most 1 request/second and wants a descriptive
 * User-Agent. We throttle to 1.1s and cache every lookup to a JSON file, so a
 * re-run (after an interruption, or for a new monthly sheet) only hits the
 * network for addresses it has not seen. We send a generic client identifier —
 * never a personal email.
 *
 * Usage:
 *   npx tsx tools/geocode-hospitals/geocode.mts \
 *     "<path to .xlsx>" \
 *     <output.csv> \
 *     [cache.json]
 */
import { parseWorkbook } from "../../apps/ops-api/src/xlsx-lite.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [, , inPath, outPath, cachePathArg] = process.argv;
if (!inPath || !outPath) {
  console.error('Usage: tsx geocode.mts "<input.xlsx>" <output.csv> [cache.json]');
  process.exit(1);
}
const cachePath = cachePathArg || `${outPath}.cache.json`;
const UA = "FlexiMOS-geocoder/1.0 (fleet ops hospital directory; one-time import)";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Lagos State viewbox (lon,lat of top-left; lon,lat of bottom-right) as a soft bias.
const LAGOS_VIEWBOX = "2.70,6.75,4.35,6.35";

const cache: Record<string, { lat: number | null; lng: number | null } > =
  existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s_]+/g, " ").trim();
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

let networkCalls = 0;
async function geocode(query: string): Promise<{ lat: number | null; lng: number | null }> {
  const key = norm(query);
  if (key in cache) return cache[key];
  await sleep(1100); // Nominatim fair-use: <= 1 req/sec
  networkCalls++;
  const url = `${NOMINATIM}?format=jsonv2&countrycodes=ng&limit=1&viewbox=${LAGOS_VIEWBOX}&q=${encodeURIComponent(query)}`;
  let result = { lat: null as number | null, lng: null as number | null };
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    if (res.ok) {
      const hits: any[] = await res.json();
      if (hits.length && hits[0].lat && hits[0].lon) {
        result = { lat: Number(hits[0].lat), lng: Number(hits[0].lon) };
      }
    } else {
      console.error(`  nominatim ${res.status} for: ${query.slice(0, 60)}`);
    }
  } catch (err: any) {
    console.error(`  geocode error (${String(err?.message).slice(0, 60)}) for: ${query.slice(0, 60)}`);
  }
  cache[key] = result;
  // Persist the cache every call so an interrupt never loses progress.
  writeFileSync(cachePath, JSON.stringify(cache));
  return result;
}

const grid = parseWorkbook(readFileSync(inPath));
const header = grid[0].map((h) => norm(h));
const col = (needle: string) => header.findIndex((h) => h.includes(needle));
const iName = col("provider") >= 0 && !header[col("provider")].includes("type") && !header[col("provider")].includes("address")
  ? header.findIndex((h) => h === "provider") : col("provider");
const iAddr = header.findIndex((h) => h.includes("address"));
const iType = header.findIndex((h) => h.includes("type"));
const iState = header.findIndex((h) => h === "state");
const iCity = header.findIndex((h) => h === "city" || h.includes("lga") || h.includes("local government"));
const rows = grid.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
console.log(`Parsed ${rows.length} facilities. name=${iName} addr=${iAddr} type=${iType} state=${iState} city=${iCity}`);

// 1) LGA centroids (the fallback). Only a handful of distinct values.
const lgaCentroid: Record<string, { lat: number | null; lng: number | null }> = {};
const uniqueLgas = [...new Set(rows.map((r) => String(r[iCity] || "").trim()).filter(Boolean))];
console.log(`Geocoding ${uniqueLgas.length} LGA centroids...`);
for (const lga of uniqueLgas) {
  lgaCentroid[norm(lga)] = await geocode(`${lga}, Lagos State, Nigeria`);
}

// 2) Each facility: street first, LGA centroid fallback.
const out: string[] = ["s_no,name,provider_type,address,state,lga,lat,lng,coords_quality"];
let street = 0, fallback = 0, failed = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const name = String(r[iName] || "").trim();
  const addr = String(r[iAddr] || "").trim();
  const type = String(r[iType] || "").trim();
  const state = String(r[iState] || "Lagos").trim();
  const lga = String(r[iCity] || "").trim();
  if (!name) continue;

  let lat: number | null = null, lng: number | null = null, quality = "failed";
  const streetHit = addr ? await geocode(`${addr}, ${lga}, Lagos, Nigeria`) : { lat: null, lng: null };
  if (streetHit.lat != null) {
    ({ lat, lng } = streetHit); quality = "street"; street++;
  } else {
    const c = lgaCentroid[norm(lga)];
    if (c && c.lat != null) { lat = c.lat; lng = c.lng; quality = "lga_centroid"; fallback++; }
    else failed++;
  }
  out.push([r[0], name, type, addr, state, lga, lat ?? "", lng ?? "", quality].map(csvCell).join(","));
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rows.length} (street ${street}, lga ${fallback}, failed ${failed}, net calls ${networkCalls})`);
}

writeFileSync(outPath, out.join("\n") + "\n");
console.log(`\nDone. ${rows.length} facilities → ${outPath}`);
console.log(`street=${street}  lga_centroid=${fallback}  failed=${failed}  (network calls this run: ${networkCalls})`);
