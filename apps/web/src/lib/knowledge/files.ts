import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { knowledgeFileExtension, MAX_KNOWLEDGE_FILE_BYTES } from "./file-rules";

const PDF_MAGIC = "%PDF-";
const TENANT_DIR = /^[0-9a-f-]{36}$/i;

export class KnowledgeFileError extends Error {}

export function tenantFilesDir(filesDir: string, tenantId: string) {
  if (!TENANT_DIR.test(tenantId)) {
    throw new KnowledgeFileError("Invalid tenant id");
  }
  return join(resolve(filesDir), tenantId);
}

export function isStoredKnowledgePath(filesDir: string, tenantId: string, path: string) {
  if (!isAbsolute(path)) {
    return false;
  }
  const target = relative(tenantFilesDir(filesDir, tenantId), resolve(path));
  return target !== "" && !target.startsWith("..") && !target.includes(sep) && !isAbsolute(target);
}

export async function saveKnowledgeFile(
  filesDir: string,
  tenantId: string,
  file: { data: Uint8Array; name: string }
) {
  const extension = knowledgeFileExtension(file.name);
  if (!extension) {
    throw new KnowledgeFileError("Knowledge files must be PDF, plain text or Markdown");
  }
  if (file.data.byteLength === 0) {
    throw new KnowledgeFileError("Knowledge file is empty");
  }
  if (file.data.byteLength > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new KnowledgeFileError("Knowledge file exceeds 20 MiB");
  }
  if (
    extension === ".pdf" &&
    Buffer.from(file.data.subarray(0, PDF_MAGIC.length)).toString("latin1") !== PDF_MAGIC
  ) {
    throw new KnowledgeFileError("File is not a valid PDF");
  }
  const dir = tenantFilesDir(filesDir, tenantId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${extension}`);
  await writeFile(path, file.data, { flag: "wx" });
  return path;
}

export async function removeKnowledgeFile(filesDir: string, tenantId: string, path: string | null) {
  if (path && isStoredKnowledgePath(filesDir, tenantId, path)) {
    await rm(path, { force: true });
  }
}
