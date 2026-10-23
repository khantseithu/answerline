import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { knowledgeSources } from "@answerline/db";
import { loadKnowledgeSource } from "./knowledge-loaders.ts";
import { assertPublicAddress, fetchKnowledgePage } from "./knowledge-url.ts";

const ABSOLUTE_PATH = /absolute/;
const CLEANINGS = /dental cleanings/;
const EXCLUDED_CONTENT = /Ignore navigation|must not execute/;
const PUBLIC_IP = /public/;
const HTTP_URL = /HTTP/;
const CREDENTIALS = /credentials/;
const REDIRECT_LIMIT = /redirect/;

function source(overrides: Partial<typeof knowledgeSources.$inferSelect> = {}) {
  return {
    agentId: null,
    content: null,
    contentHash: null,
    createdAt: new Date(),
    error: null,
    id: crypto.randomUUID(),
    ingestedAt: null,
    status: "pending" as const,
    tenantId: crypto.randomUUID(),
    title: "Services",
    type: "text" as const,
    updatedAt: new Date(),
    uri: null,
    ...overrides,
  };
}

function pdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return document;
}

test("loads inline text and validates Q&A pairs with citation metadata", async () => {
  const input = source({ content: " Opening hours " });
  const [text] = await loadKnowledgeSource(input);
  assert.equal(text?.text, "Opening hours");
  assert.equal(text?.metadata.sourceId, input.id);
  assert.equal(text?.metadata.title, "Services");
  const [pair] = await loadKnowledgeSource(
    source({ content: [{ answer: "At nine", question: "When do you open?" }], type: "qa" })
  );
  assert.equal(pair?.text, "Question: When do you open?\nAnswer: At nine");
  assert.equal(pair?.metadata.qaIndex, 0);
  await assert.rejects(loadKnowledgeSource(source({ content: "invalid", type: "qa" })));
  await assert.rejects(loadKnowledgeSource(source({ content: "   " })));
});

test("loads PDF pages and plain text/Markdown files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "answerline-loaders-"));
  try {
    const markdown = join(directory, "hours.md");
    const plain = join(directory, "hours.txt");
    const document = join(directory, "hours.pdf");
    await Promise.all([
      writeFile(markdown, "# Opening hours\nWeekdays at nine"),
      writeFile(plain, "Weekdays at nine"),
      writeFile(document, pdf("Weekdays at nine")),
    ]);
    const [md, txt, pages] = await Promise.all(
      [markdown, plain, document].map((uri) => loadKnowledgeSource(source({ type: "file", uri })))
    );
    assert.equal(md?.[0]?.text, "# Opening hours\nWeekdays at nine");
    assert.equal(txt?.[0]?.text, "Weekdays at nine");
    assert.equal(pages?.[0]?.text, "Weekdays at nine");
    assert.equal(pages?.[0]?.metadata.page, 1);
    await assert.rejects(
      loadKnowledgeSource(source({ type: "file", uri: "relative.md" })),
      ABSOLUTE_PATH
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("extracts readable URL content without navigation or scripts", async () => {
  const documents = await loadKnowledgeSource(
    source({ title: null, type: "url", uri: "https://example.com/services" }),
    {
      fetchPage: async () => ({
        body: `<html><head><title>Clinic services</title></head><body><nav>Ignore navigation</nav><article><h1>Our services</h1><p>${"We provide dental cleanings and examinations on weekdays. ".repeat(20)}</p></article><script>throw new Error('must not execute')</script></body></html>`,
        contentType: "text/html",
        uri: "https://example.com/services",
      }),
    }
  );
  assert.match(documents[0]?.text ?? "", CLEANINGS);
  assert.doesNotMatch(documents[0]?.text ?? "", EXCLUDED_CONTENT);
  assert.equal(documents[0]?.metadata.title, "Clinic services");
});

test("loads a plain text URL", async () => {
  const documents = await loadKnowledgeSource(
    source({ type: "url", uri: "https://example.com/hours" }),
    {
      fetchPage: async () => ({
        body: "Open at nine",
        contentType: "text/plain",
        uri: "https://example.com/hours",
      }),
    }
  );
  assert.equal(documents[0]?.text, "Open at nine");
});

test("URL loader blocks non-public IPv4, IPv6 and mapped addresses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.throws(() => assertPublicAddress(address), PUBLIC_IP);
  }
  assert.doesNotThrow(() => assertPublicAddress("8.8.8.8"));
  assert.doesNotThrow(() => assertPublicAddress("2606:4700:4700::1111"));
  await assert.rejects(fetchKnowledgePage("http://127.0.0.1/private"), PUBLIC_IP);
  await assert.rejects(fetchKnowledgePage("file:///etc/passwd"), HTTP_URL);
  await assert.rejects(fetchKnowledgePage("https://user:pass@example.com"), CREDENTIALS);
  await assert.rejects(fetchKnowledgePage("https://example.com", 5), REDIRECT_LIMIT);
});
