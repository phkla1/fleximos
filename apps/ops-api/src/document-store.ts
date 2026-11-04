import { Injectable } from "@nestjs/common";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { integrationVar } from "./integration-env.js";

// A place bytes physically live. storage_path is opaque to callers and is only
// ever interpreted by the backend that produced it, so the backend that holds a
// file is recorded alongside it (ops_media_files.storage_backend) and reads route
// back to the same one. Swapping/adding a backend is a config change, not a
// schema or API change.
export interface DocumentStore {
  readonly backend: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  get(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
}

// Local disk — the existing media behaviour, and the test/dev/CI default. Also
// the home for high-volume, latency-sensitive operational camera media, which we
// never route to a remote document store.
export class LocalDiskStore implements DocumentStore {
  readonly backend = "local";
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir || process.env.FLEXI_OPS_MEDIA_DIR || `${process.env.FLEXI_OPS_DB_DIR || ".data/ops-pglite"}-media`;
  }

  async put(key: string, bytes: Buffer): Promise<string> {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, key), bytes);
    return key;
  }

  async get(storagePath: string): Promise<Buffer> {
    return readFileSync(join(this.dir, storagePath));
  }

  async delete(storagePath: string): Promise<void> {
    const { rmSync } = await import("node:fs");
    rmSync(join(this.dir, storagePath), { force: true });
  }
}

// Seafile — the production backend for document kinds. FlexiMOS owns ONE private
// library through a dedicated service account; it never touches Seafile's admin /
// user management, and the library is not shared to staff inside Seafile (reads
// are mediated by FlexiMOS so the HR/admin+owner scoping holds). Seafile's own
// Web API: get an upload link, POST the file to it; get a download link, GET the
// bytes; DELETE by path.
export class SeafileStore implements DocumentStore {
  readonly backend = "seafile";

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly repoId: string
  ) {}

  private headers() {
    return { Authorization: `Token ${this.token}` };
  }

  private parentOf(storagePath: string) {
    const slash = storagePath.lastIndexOf("/");
    return { dir: slash <= 0 ? "/" : storagePath.slice(0, slash), name: storagePath.slice(slash + 1) };
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<string> {
    const storagePath = key.startsWith("/") ? key : `/${key}`;
    const { dir, name } = this.parentOf(storagePath);
    // Upload at the repo root with a relative_path: Seafile creates every
    // intermediate folder automatically, so a three-deep document path
    // (/operator/<id>/<doc_type>/) needs no separate mkdir per level.
    const relativePath = dir === "/" ? "" : dir.replace(/^\//, "");

    const linkResponse = await fetch(
      `${this.baseUrl}/api2/repos/${this.repoId}/upload-link/?p=/`,
      { headers: this.headers() }
    );
    if (!linkResponse.ok) throw new Error(`Seafile upload-link failed (${linkResponse.status}).`);
    const uploadUrl = (await linkResponse.json() as string).replace(/"/g, "");

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), name);
    form.append("parent_dir", "/");
    if (relativePath) form.append("relative_path", relativePath);
    form.append("replace", "1");
    const upload = await fetch(uploadUrl, { method: "POST", headers: this.headers(), body: form });
    if (!upload.ok) throw new Error(`Seafile upload failed (${upload.status}).`);
    return storagePath;
  }

  async get(storagePath: string): Promise<Buffer> {
    const linkResponse = await fetch(
      `${this.baseUrl}/api2/repos/${this.repoId}/file/?p=${encodeURIComponent(storagePath)}&reuse=1`,
      { headers: this.headers() }
    );
    if (!linkResponse.ok) throw new Error(`Seafile file-link failed (${linkResponse.status}).`);
    const downloadUrl = (await linkResponse.json() as string).replace(/"/g, "");
    const file = await fetch(downloadUrl, { headers: this.headers() });
    if (!file.ok) throw new Error(`Seafile download failed (${file.status}).`);
    return Buffer.from(await file.arrayBuffer());
  }

  async delete(storagePath: string): Promise<void> {
    await fetch(`${this.baseUrl}/api2/repos/${this.repoId}/file/?p=${encodeURIComponent(storagePath)}`, {
      method: "DELETE",
      headers: this.headers()
    });
  }
}

// Kinds that are company documents (vs operational camera captures). These route
// to the configured document backend; everything else stays on local disk.
const documentKinds = new Set([
  "operator_document",
  "vehicle_document",
  "fuel_receipt"
]);

@Injectable()
export class DocumentStoreService {
  private readonly stores = new Map<string, DocumentStore>();
  private readonly local = new LocalDiskStore();
  // Which backend document kinds are written to: 'local' (default) or 'seafile'.
  private readonly documentBackend: string;

  constructor() {
    this.stores.set("local", this.local);
    const baseUrl = integrationVar(process.env, "SEAFILE_BASE_URL");
    const token = integrationVar(process.env, "SEAFILE_API_TOKEN");
    const repoId = integrationVar(process.env, "SEAFILE_REPO_ID");
    if (baseUrl && token && repoId) {
      this.stores.set("seafile", new SeafileStore(baseUrl.replace(/\/$/, ""), token, repoId));
    }
    const requested = (process.env.FLEXI_DOC_STORE || "local").toLowerCase();
    // Fall back to local if seafile was requested but isn't configured yet, so a
    // half-provisioned environment degrades safely instead of failing uploads.
    this.documentBackend = requested === "seafile" && this.stores.has("seafile") ? "seafile" : "local";
  }

  // The backend a newly-uploaded file of this kind should be written to.
  backendFor(kind: string): string {
    return documentKinds.has(kind) ? this.documentBackend : "local";
  }

  private store(backend: string): DocumentStore {
    const store = this.stores.get(backend);
    if (!store) throw new Error(`Storage backend '${backend}' is not configured in this environment.`);
    return store;
  }

  async put(backend: string, key: string, bytes: Buffer, contentType: string): Promise<string> {
    return this.store(backend).put(key, bytes, contentType);
  }

  async get(backend: string, storagePath: string): Promise<Buffer> {
    return this.store(backend).get(storagePath);
  }

  async delete(backend: string, storagePath: string): Promise<void> {
    return this.store(backend).delete(storagePath);
  }
}
