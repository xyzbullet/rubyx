/**
 * CRX / unpacked extension parser.
 * Handles CRX3 archives (magic "Cr24" + protobuf header, then a ZIP payload)
 * as well as plain .zip bundles and unpacked directories (manifest.json scan).
 */
import { unzipSync } from "fflate";

export interface ExtensionMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  manifestVersion: number;
  permissions: string[];
  contentScripts: string[];
  fileCount: number;
  source: "crx" | "zip" | "unpacked";
  enabled: boolean;
  loadedAt: number;
}

function fromManifest(raw: string, source: ExtensionMeta["source"], fileCount: number): ExtensionMeta {
  const m = JSON.parse(raw) as Record<string, unknown>;
  const cs = Array.isArray(m.content_scripts)
    ? (m.content_scripts as Array<{ matches?: string[] }>).flatMap((c) => c.matches ?? [])
    : [];
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: String(m.name ?? "Unnamed extension"),
    version: String(m.version ?? "0.0.0"),
    description: String(m.description ?? "").slice(0, 220),
    manifestVersion: Number(m.manifest_version ?? 2),
    permissions: Array.isArray(m.permissions) ? (m.permissions as string[]).slice(0, 12) : [],
    contentScripts: [...new Set(cs)].slice(0, 8),
    fileCount,
    source,
    enabled: true,
    loadedAt: Date.now(),
  };
}

/** Parse a .crx or .zip archive file. */
export async function parseExtensionArchive(file: File): Promise<ExtensionMeta> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let zipStart = 0;

  // CRX3: "Cr24" | u32 version | u32 header_size | protobuf header | zip
  if (buf.length > 12 && buf[0] === 0x43 && buf[1] === 0x72 && buf[2] === 0x32 && buf[3] === 0x34) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const headerSize = dv.getUint32(8, true);
    zipStart = 12 + headerSize;
  } else if (buf[0] === 0x50 && buf[1] === 0x4b) {
    zipStart = 0; // plain zip
  } else {
    throw new Error("Not a CRX3 or ZIP archive (bad magic bytes).");
  }

  const entries = unzipSync(buf.slice(zipStart));
  const keys = Object.keys(entries);
  const manifestKey = keys
    .filter((k) => /(^|\/)manifest\.json$/i.test(k))
    .sort((a, b) => a.length - b.length)[0];
  if (!manifestKey) throw new Error("manifest.json not found inside archive.");
  return fromManifest(new TextDecoder().decode(entries[manifestKey]), file.name.endsWith(".crx") ? "crx" : "zip", keys.length);
}

/** Parse an unpacked extension directory chosen via <input webkitdirectory>. */
export async function parseUnpackedDirectory(files: FileList): Promise<ExtensionMeta> {
  const list = Array.from(files).filter((f) => /(^|\/)manifest\.json$/i.test(f.name));
  if (!list.length) throw new Error("No manifest.json found in that directory.");
  list.sort((a, b) => a.webkitRelativePath.length - b.webkitRelativePath.length);
  const raw = await list[0].text();
  return fromManifest(raw, "unpacked", files.length);
}
