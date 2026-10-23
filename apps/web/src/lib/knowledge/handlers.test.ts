import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createDb,
  EMBEDDING_DIMENSIONS,
  knowledgeChunks,
  knowledgeSources,
  tenants,
} from "@answerline/db";
import type { IngestionJob } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { createKnowledgeHandlers } from "./handlers.ts";
import type { KnowledgeDeps } from "./service.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

interface Harness {
  deps: KnowledgeDeps;
  enqueued: IngestionJob[];
  handlers: ReturnType<typeof createKnowledgeHandlers>;
  otherTenantId: string;
  setEnqueueFailure: (failure: boolean) => void;
}

async function withHarness(run: (harness: Harness) => Promise<void>) {
  const db = createDb();
  const filesDir = await mkdtemp(join(tmpdir(), "answerline-knowledge-"));
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  const enqueued: IngestionJob[] = [];
  let failEnqueue = false;
  try {
    await db.insert(tenants).values([
      { id: tenantId, name: "Knowledge test", slug: `knowledge-${tenantId}` },
      { id: otherTenantId, name: "Other", slug: `knowledge-${otherTenantId}` },
    ]);
    const deps: KnowledgeDeps = {
      db,
      enqueue: (data) => {
        if (failEnqueue) {
          return Promise.reject(new Error("redis down"));
        }
        enqueued.push(data);
        return Promise.resolve();
      },
      filesDir,
      tenantId,
    };
    await run({
      deps,
      enqueued,
      handlers: createKnowledgeHandlers(() => Promise.resolve(deps)),
      otherTenantId,
      setEnqueueFailure: (failure) => {
        failEnqueue = failure;
      },
    });
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await db.$client.end();
    await rm(filesDir, { force: true, recursive: true });
  }
}

const json = (body: unknown) =>
  new Request("http://localhost/api/v1/knowledge", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

function upload(name: string, content: string) {
  const form = new FormData();
  form.set("file", new File([content], name));
  return new Request("http://localhost/api/v1/knowledge/files", { body: form, method: "POST" });
}

async function bodyOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("creates text, Q&A and URL sources and enqueues each", { skip }, () =>
  withHarness(async ({ deps, enqueued, handlers }) => {
    const text = await handlers.create(
      json({ content: "Open at nine", title: "Hours", type: "text" })
    );
    const qa = await handlers.create(
      json({ pairs: [{ answer: "Yes", question: "Walk-ins?" }], title: "FAQ", type: "qa" })
    );
    const url = await handlers.create(json({ type: "url", url: "https://example.com/faq" }));
    assert.deepEqual([text.status, qa.status, url.status], [201, 201, 201]);
    assert.equal(enqueued.length, 3);
    assert.ok(enqueued.every((job) => job.tenantId === deps.tenantId));

    const rows = await deps.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.tenantId, deps.tenantId));
    const byType = Object.fromEntries(rows.map((row) => [row.type, row]));
    assert.equal(byType.text?.content, "Open at nine");
    assert.deepEqual(byType.qa?.content, [{ answer: "Yes", question: "Walk-ins?" }]);
    assert.equal(byType.url?.uri, "https://example.com/faq");
    assert.ok(rows.every((row) => row.status === "pending"));
  })
);

test("lists only the current tenant's sources with counts", { skip }, () =>
  withHarness(async ({ deps, handlers, otherTenantId }) => {
    await handlers.create(json({ content: "Open at nine", title: "Hours", type: "text" }));
    await handlers.create(
      json({
        pairs: [
          { answer: "A", question: "Q1" },
          { answer: "B", question: "Q2" },
        ],
        title: "FAQ",
        type: "qa",
      })
    );
    await deps.db
      .insert(knowledgeSources)
      .values({ content: "secret", tenantId: otherTenantId, title: "Other", type: "text" });
    const { sources } = (await bodyOf(await handlers.list())) as {
      sources: { itemCount: number | null; title: string; type: string; uri: string | null }[];
    };
    assert.equal(sources.length, 2);
    assert.deepEqual(sources.map((source) => [source.type, source.itemCount]).sort(), [
      ["qa", 2],
      ["text", 12],
    ]);
    assert.ok(sources.every((source) => source.title !== "Other"));
  })
);

test("uploads a file under the tenant directory and hides the path", { skip }, () =>
  withHarness(async ({ deps, enqueued, handlers }) => {
    const response = await handlers.upload(upload("faq.md", "# Hours\nNine to five"));
    assert.equal(response.status, 201);
    assert.equal(enqueued.length, 1);
    const [row] = await deps.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.tenantId, deps.tenantId));
    assert.ok(row?.uri?.startsWith(join(deps.filesDir, deps.tenantId)));
    assert.ok(row?.uri && existsSync(row.uri));
    assert.equal(row?.title, "faq.md");
    const { sources } = (await bodyOf(await handlers.list())) as { sources: { uri: unknown }[] };
    assert.equal(sources[0]?.uri, null);
  })
);

test("rejects invalid uploads without storing anything", { skip }, () =>
  withHarness(async ({ deps, handlers }) => {
    assert.equal((await handlers.upload(upload("evil.exe", "x"))).status, 400);
    assert.equal((await handlers.upload(upload("fake.pdf", "not a pdf"))).status, 400);
    assert.equal(
      (
        await handlers.upload(
          new Request("http://localhost/api/v1/knowledge/files", {
            body: new FormData(),
            method: "POST",
          })
        )
      ).status,
      400
    );
    assert.equal(
      (
        await handlers.upload(
          new Request("http://localhost/api/v1/knowledge/files", {
            body: "x",
            headers: { "Content-Length": String(30 * 1024 * 1024) },
            method: "POST",
          })
        )
      ).status,
      400
    );
    const rows = await deps.db.select().from(knowledgeSources);
    assert.ok(rows.every((row) => row.tenantId !== deps.tenantId));
  })
);

test("rejects malformed and invalid create requests", { skip }, () =>
  withHarness(async ({ enqueued, handlers }) => {
    assert.equal((await handlers.create(json("not json"))).status, 400);
    assert.equal((await handlers.create(json({ type: "url", url: "ftp://x.test" }))).status, 400);
    assert.equal(
      (await handlers.create(json({ content: "x", title: "", type: "text" }))).status,
      400
    );
    assert.equal(enqueued.length, 0);
  })
);

test("keeps the source and reports 503 when queueing fails", { skip }, () =>
  withHarness(async ({ deps, handlers, setEnqueueFailure }) => {
    setEnqueueFailure(true);
    const response = await handlers.create(json({ content: "x", title: "t", type: "text" }));
    assert.equal(response.status, 503);
    const rows = await deps.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.tenantId, deps.tenantId));
    assert.equal(rows.length, 1);
  })
);

test("re-syncs a source and rejects unknown or foreign ids", { skip }, () =>
  withHarness(async ({ deps, enqueued, handlers, otherTenantId }) => {
    const { id } = (await bodyOf(
      await handlers.create(json({ content: "x", title: "t", type: "text" }))
    )) as { id: string };
    enqueued.length = 0;
    const response = await handlers.resync(new Request("http://localhost"), id);
    assert.equal(response.status, 202);
    assert.deepEqual(enqueued, [{ sourceId: id, tenantId: deps.tenantId }]);

    const [foreign] = await deps.db
      .insert(knowledgeSources)
      .values({ content: "x", tenantId: otherTenantId, type: "text" })
      .returning({ id: knowledgeSources.id });
    assert.ok(foreign);
    const missing = await Promise.all(
      [MISSING_ID, foreign.id].map((target) =>
        handlers.resync(new Request("http://localhost"), target)
      )
    );
    assert.deepEqual(
      missing.map((result) => result.status),
      [404, 404]
    );
    assert.equal((await handlers.resync(new Request("http://localhost"), "nope")).status, 400);
    assert.equal(enqueued.length, 1);
  })
);

test("deletes a source with its chunks and stored file", { skip }, () =>
  withHarness(async ({ deps, handlers, otherTenantId }) => {
    await handlers.upload(upload("faq.txt", "Open at nine"));
    const [source] = await deps.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.tenantId, deps.tenantId));
    assert.ok(source?.uri);
    await deps.db.insert(knowledgeChunks).values({
      content: "Open at nine",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0)),
      seq: 0,
      sourceId: source.id,
      tenantId: deps.tenantId,
    });

    const [foreign] = await deps.db
      .insert(knowledgeSources)
      .values({ content: "x", tenantId: otherTenantId, type: "text" })
      .returning({ id: knowledgeSources.id });
    assert.ok(foreign);
    assert.equal((await handlers.remove(new Request("http://localhost"), foreign.id)).status, 404);

    const response = await handlers.remove(new Request("http://localhost"), source.id);
    assert.equal(response.status, 204);
    assert.deepEqual(
      await deps.db.select().from(knowledgeSources).where(eq(knowledgeSources.id, source.id)),
      []
    );
    assert.deepEqual(
      await deps.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, source.id)),
      []
    );
    assert.ok(!existsSync(source.uri));
    assert.equal((await handlers.remove(new Request("http://localhost"), source.id)).status, 404);
  })
);

test("never deletes files outside the tenant directory", { skip }, () =>
  withHarness(async ({ deps, handlers }) => {
    const outside = join(deps.filesDir, "outside.txt");
    await writeFile(outside, "keep");
    const [source] = await deps.db
      .insert(knowledgeSources)
      .values({ tenantId: deps.tenantId, type: "file", uri: outside })
      .returning({ id: knowledgeSources.id });
    assert.ok(source);
    assert.equal((await handlers.remove(new Request("http://localhost"), source.id)).status, 204);
    assert.ok(existsSync(outside));
  })
);
