import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { knowledgeFileExtension, MAX_KNOWLEDGE_FILE_BYTES } from "./file-rules.ts";
import {
  isStoredKnowledgePath,
  KnowledgeFileError,
  removeKnowledgeFile,
  saveKnowledgeFile,
  tenantFilesDir,
} from "./files.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const STORED_NAME = /^[0-9a-f-]{36}\.md$/;
const bytes = (text: string) => new TextEncoder().encode(text);

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "answerline-files-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

test("accepts only supported extensions case-insensitively", () => {
  assert.equal(knowledgeFileExtension("Menu.PDF"), ".pdf");
  assert.equal(knowledgeFileExtension("notes.md"), ".md");
  assert.equal(knowledgeFileExtension("notes.markdown"), ".markdown");
  assert.equal(knowledgeFileExtension("notes.txt"), ".txt");
  assert.equal(knowledgeFileExtension("script.exe"), undefined);
  assert.equal(knowledgeFileExtension("pdf"), undefined);
  assert.equal(knowledgeFileExtension(".md"), undefined);
});

test("stores files under the tenant directory with a generated name", () =>
  withDir(async (dir) => {
    const path = await saveKnowledgeFile(dir, TENANT, {
      data: bytes("# Hours"),
      name: "../../etc/evil name.md",
    });
    assert.equal(dirname(path), tenantFilesDir(dir, TENANT));
    assert.match(path.slice(dirname(path).length + 1), STORED_NAME);
    assert.equal(await readFile(path, "utf8"), "# Hours");
    assert.ok(isStoredKnowledgePath(dir, TENANT, path));
  }));

test("rejects unsupported, empty, oversized and fake PDF uploads", () =>
  withDir(async (dir) => {
    const reject = (name: string, data: Uint8Array) =>
      assert.rejects(saveKnowledgeFile(dir, TENANT, { data, name }), KnowledgeFileError);
    await reject("a.exe", bytes("x"));
    await reject("a.md", new Uint8Array());
    await reject("a.txt", new Uint8Array(MAX_KNOWLEDGE_FILE_BYTES + 1));
    await reject("a.pdf", bytes("not a pdf"));
    const pdf = await saveKnowledgeFile(dir, TENANT, {
      data: bytes("%PDF-1.7 body"),
      name: "a.pdf",
    });
    assert.ok(existsSync(pdf));
  }));

test("rejects tenant ids that could escape the files directory", () => {
  assert.throws(() => tenantFilesDir("/data", "../x"), KnowledgeFileError);
});

test("only treats direct children of the tenant directory as stored files", () => {
  const root = tenantFilesDir("/data/knowledge", TENANT);
  assert.ok(isStoredKnowledgePath("/data/knowledge", TENANT, join(root, "a.md")));
  assert.ok(!isStoredKnowledgePath("/data/knowledge", TENANT, root));
  assert.ok(!isStoredKnowledgePath("/data/knowledge", TENANT, join(root, "..", "a.md")));
  assert.ok(!isStoredKnowledgePath("/data/knowledge", TENANT, join(root, "sub", "a.md")));
  assert.ok(!isStoredKnowledgePath("/data/knowledge", TENANT, "/etc/passwd"));
  assert.ok(!isStoredKnowledgePath("/data/knowledge", TENANT, "relative.md"));
  assert.ok(
    !isStoredKnowledgePath(
      "/data/knowledge",
      TENANT,
      join(tenantFilesDir("/data/knowledge", OTHER_TENANT), "a.md")
    )
  );
});

test("removes stored files but never paths outside the tenant directory", () =>
  withDir(async (dir) => {
    const stored = await saveKnowledgeFile(dir, TENANT, { data: bytes("hi"), name: "a.txt" });
    const outside = join(dir, "outside.txt");
    await writeFile(outside, "keep");
    await removeKnowledgeFile(dir, TENANT, stored);
    await removeKnowledgeFile(dir, TENANT, outside);
    await removeKnowledgeFile(dir, TENANT, null);
    assert.ok(!existsSync(stored));
    assert.ok(existsSync(outside));
  }));
