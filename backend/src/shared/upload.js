import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { env } from "../config/env.js";
import { FILE_SIGNATURES, HARD_UPLOAD_LIMIT_MB, MIME_BY_EXT } from "./constants.js";
import { AppError, badRequest } from "./errors.js";

const tmpDir = path.join(env.uploadDir, ".tmp");

/** Disk upload for review attachments. Files land in a private temp folder with random names, then are validated and moved. */
export const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => fs.mkdir(tmpDir, { recursive: true }, (err) => cb(err, tmpDir)),
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: HARD_UPLOAD_LIMIT_MB * 1024 * 1024, files: 1, fields: 20, fieldSize: 200 * 1024 },
}).single("file");

/** Memory upload for small CSV/XLSX import files. */
export const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single("file");

/**
 * Makes sure the upload directory exists and is writable (called at boot and by the readiness probe's cheaper variant).
 * Files live on local disk, so in production this must be a persistent volume; the check only proves it is writable.
 */
export async function ensureUploadDir() {
  await fsp.mkdir(env.uploadDir, { recursive: true });
  const probe = path.join(env.uploadDir, `.write-test-${process.pid}`);
  await fsp.writeFile(probe, "ok");
  await fsp.rm(probe, { force: true });
  return env.uploadDir;
}
export const uploadDirWritable = () => fsp.access(env.uploadDir, fs.constants.W_OK).then(() => true, () => false);

/** Runs the configured scanner (no shell). Resolves "clean" | "infected" | "error". */
function runScanner(filePath) {
  const { bin, args, timeoutMs } = env.scanner;
  return new Promise((resolve) => {
    execFile(bin, args.map((a) => a.replaceAll("{file}", filePath)), { timeout: timeoutMs, windowsHide: true }, (err) => {
      if (!err) return resolve("clean");
      if (!err.killed && err.code === 1) return resolve("infected"); // ClamAV convention
      console.error(`Upload scanner error (${err.killed ? "timeout" : `exit ${err.code ?? err.message}`}).`);
      resolve("error");
    });
  });
}

/** Moves a rejected file out of the normal tree (no extension, never served) so it can be inspected by an administrator. */
async function quarantine(file, sha256) {
  const dir = path.join(env.uploadDir, ".quarantine");
  await fsp.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  await fsp.rename(file.path, path.join(dir, id));
  console.warn(`Upload quarantined as ${id} (${file.size} bytes, sha256 ${sha256}, original name "${safeOriginalName(file.originalname)}").`);
}

export const safeOriginalName = (name) =>
  path.basename(String(name || "file")).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").slice(0, 120) || "file";

export const removeTemp = (file) => (file?.path ? fsp.rm(file.path, { force: true }).catch(() => {}) : Promise.resolve());

/** Validates extension, size and file signature, then moves the file to its permanent private location. */
export async function finalizeUpload(file, { acceptedTypes, maxSizeMB, folder }) {
  try {
    const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
    const allowed = acceptedTypes.map((t) => t.toLowerCase());
    if (!ext || !allowed.includes(ext) || !FILE_SIGNATURES[ext]) throw badRequest(`File type not allowed. Accepted: ${allowed.join(", ")}`);
    if (file.size > maxSizeMB * 1024 * 1024) throw badRequest(`File is too large. Maximum size is ${maxSizeMB} MB`);
    const fh = await fsp.open(file.path, "r");
    const head = Buffer.alloc(8);
    await fh.read(head, 0, 8, 0);
    await fh.close();
    if (!FILE_SIGNATURES[ext].some((sig) => head.subarray(0, sig.length).equals(sig))) throw badRequest(`The file content does not match a valid .${ext} file`);

    const sha256 = await new Promise((resolve, reject) => {
      const h = crypto.createHash("sha256");
      fs.createReadStream(file.path).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
    });
    if (env.scanner.bin) {
      const verdict = await runScanner(file.path);
      if (verdict === "infected") {
        await quarantine(file, sha256);
        throw new AppError(422, "The file failed the security scan and was rejected.");
      }
      if (verdict === "error" && env.scanner.required) throw new AppError(503, "The file could not be security-scanned right now. Please try again later.");
    }
    const storedName = `${crypto.randomUUID()}.${ext}`;
    const dir = path.join(env.uploadDir, String(folder));
    await fsp.mkdir(dir, { recursive: true });
    await fsp.rename(file.path, path.join(dir, storedName));
    return { storedName: `${folder}/${storedName}`, originalName: safeOriginalName(file.originalname), size: file.size, mimeType: MIME_BY_EXT[ext], sha256 };
  } catch (err) {
    await removeTemp(file);
    throw err;
  }
}

/** Resolves a stored name to an absolute path, refusing anything that escapes the upload directory. */
export function resolveStoredFile(storedName) {
  const abs = path.resolve(env.uploadDir, storedName);
  if (!abs.startsWith(path.resolve(env.uploadDir) + path.sep)) throw badRequest("Invalid file reference");
  return abs;
}
