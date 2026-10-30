import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Private object storage on local disk. Nothing under this directory is served statically: every byte
 * leaves through a route that has already run the policy check. Swap for S3/GCS in production behind the
 * same two functions.
 */
function root(): string {
  return path.resolve(process.env.PRIVATE_STORAGE_DIR ?? "./storage");
}

/** Resolves a key inside the storage root, rejecting anything that would escape it. */
function resolveKey(key: string): string {
  const full = path.resolve(root(), key);
  if (full !== root() && !full.startsWith(root() + path.sep)) throw new Error("invalid storage key");
  return full;
}

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

/** Server-generated key: the client's filename never reaches the filesystem. */
export function newStorageKey(ext: string): string {
  return `uploads/${randomUUID()}.${ext}`;
}

// Types accepted for upload, with magic-number checks so a renamed file is not trusted on its extension.
// SVG is deliberately excluded from uploads: it can carry script.
export const UPLOAD_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 },
  "application/pdf": { ext: "pdf", magic: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  "video/mp4": { ext: "mp4", magic: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  "video/webm": { ext: "webm", magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadCheck = { ok: true; ext: string } | { ok: false; reason: string };

export function checkUpload(declaredType: string, bytes: Uint8Array): UploadCheck {
  const spec = UPLOAD_TYPES[declaredType];
  if (!spec) return { ok: false, reason: "file type not allowed" };
  if (bytes.length === 0) return { ok: false, reason: "file is empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "file is too large" };
  if (!spec.magic(bytes)) return { ok: false, reason: "file content does not match its declared type" };
  return { ok: true, ext: spec.ext };
}
