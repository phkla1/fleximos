import { inflateRawSync } from "node:zlib";

// Minimal, dependency-free .xlsx reader — just enough to turn a Speedaf
// Delivery-Waybill export into rows. An .xlsx is a ZIP of XML; we read the
// central directory, inflate the sheet + shared strings, and map cells by the
// header row. Shared by the manual upload path and the headless pull connector
// so there is exactly one parser to trust.

type ZipEntry = { name: string; method: number; offset: number; compSize: number };

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  // Locate the End Of Central Directory record (scan back for its signature).
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx (no ZIP end-of-directory).");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < entryCount; n++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compSize = buffer.readUInt32LE(pointer + 20);
    const nameLen = buffer.readUInt16LE(pointer + 28);
    const extraLen = buffer.readUInt16LE(pointer + 30);
    const commentLen = buffer.readUInt16LE(pointer + 32);
    const offset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLen);
    entries.push({ name, method, offset, compSize });
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    // Local file header: recompute data start from its own name/extra lengths.
    if (buffer.readUInt32LE(entry.offset) !== 0x04034b50) continue;
    const nameLen = buffer.readUInt16LE(entry.offset + 26);
    const extraLen = buffer.readUInt16LE(entry.offset + 28);
    const dataStart = entry.offset + 30 + nameLen + extraLen;
    const raw = buffer.subarray(dataStart, dataStart + entry.compSize);
    files.set(entry.name, entry.method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
  }
  return files;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
    const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXmlEntities(match[1]));
    strings.push(parts.join(""));
  }
  return strings;
}

// Column letters ("A","AB") -> zero-based index.
function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function cellValue(cell: string, shared: string[]): string {
  const typeMatch = cell.match(/\st="([^"]+)"/);
  const type = typeMatch ? typeMatch[1] : "";
  if (type === "inlineStr") {
    const inline = cell.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    return inline ? decodeXmlEntities(inline[1]) : "";
  }
  const valueMatch = cell.match(/<v>([\s\S]*?)<\/v>/);
  if (!valueMatch) return "";
  const value = valueMatch[1];
  if (type === "s") return shared[Number(value)] ?? "";
  return decodeXmlEntities(value);
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
    const cells = rowXml.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) || [];
    const values: string[] = [];
    for (const cell of cells) {
      const refMatch = cell.match(/\sr="([A-Z]+)\d+"/);
      const index = refMatch ? columnIndex(refMatch[1]) : values.length;
      values[index] = cellValue(cell, shared);
    }
    rows.push([...values].map((value) => value ?? ""));
  }
  return rows;
}

// Header text -> our field name. Tolerant to Speedaf's exact wording.
function fieldFor(header: string): string | null {
  const value = header.toLowerCase().trim();
  if (value.includes("waybill") && value.includes("status")) return "waybill_status";
  if (value.includes("waybill") && (value.includes("no") || value.includes("number"))) return "waybill_no";
  if (value.includes("courier") || value.includes("deliveryman") || value.includes("rider")) return "courier";
  if (value.includes("last scan time") || (value.includes("scan") && value.includes("time"))) return "last_scan_time";
  if (value.includes("site of last scan")) return "site_of_last_scan";
  if (value.includes("last scan")) return "last_scan";
  if (value.includes("delivery type")) return "delivery_type";
  if (value.includes("attemp")) return "attempts";
  return null;
}

export type ParsedDeliveryRow = {
  waybill_no?: string;
  waybill_status?: string;
  last_scan?: string;
  last_scan_time?: string;
  site_of_last_scan?: string;
  delivery_type?: string;
  courier?: string;
  attempts?: string;
};

export function parseDeliveryExport(buffer: Buffer): ParsedDeliveryRow[] {
  const files = readZipEntries(buffer);
  const shared = parseSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8"));
  // First worksheet by convention.
  const sheetName = [...files.keys()].find((name) => /^xl\/worksheets\/sheet1\.xml$/.test(name))
    || [...files.keys()].find((name) => /^xl\/worksheets\/.*\.xml$/.test(name));
  if (!sheetName) throw new Error("No worksheet found in the .xlsx.");
  const grid = parseSheet(files.get(sheetName)!.toString("utf8"), shared);
  if (!grid.length) return [];
  const header = grid[0].map(fieldFor);
  const rows: ParsedDeliveryRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells.some((cell) => String(cell).trim() !== "")) continue;
    const row: Record<string, string> = {};
    header.forEach((field, index) => {
      if (field && cells[index] !== undefined) row[field] = String(cells[index]).trim();
    });
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}
