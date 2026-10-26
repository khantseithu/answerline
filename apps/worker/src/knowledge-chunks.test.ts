import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkKnowledge, knowledgeContentHash } from "./knowledge-chunks.ts";

const MODEL = "openai/text-embedding-3-small";

const CHUNK_SIZES = /Chunk sizes/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

test("chunks with exact overlap, bounded lengths and source metadata", () => {
  const text = "abcdefghijklmnopqrstuvwxyz".repeat(8);
  const chunks = chunkKnowledge(
    [{ metadata: { page: 2, sourceId: "source", uri: "file:///faq.pdf" }, text }],
    { maxChars: 50, overlapChars: 10 }
  );
  assert.ok(chunks.length > 1);
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.seq, index);
    assert.ok(chunk.content.length <= 50);
    assert.equal(chunk.metadata.page, 2);
    assert.equal(chunk.metadata.sourceId, "source");
    assert.equal(chunk.metadata.uri, "file:///faq.pdf");
    const previous = chunks[index - 1];
    if (previous) {
      assert.equal(previous.content.slice(-10), chunk.content.slice(0, 10));
    }
  }
  const reconstructed = chunks
    .map((chunk, index) => (index === 0 ? chunk.content : chunk.content.slice(10)))
    .join("");
  assert.equal(reconstructed, text);
});

test("prefers word boundaries, keeps documents separate and skips empty text", () => {
  const chunks = chunkKnowledge(
    [
      { metadata: { page: 1 }, text: "one two three four five six seven eight nine ten" },
      { metadata: { page: 2 }, text: "short answer" },
      { metadata: { page: 3 }, text: "  " },
    ],
    { maxChars: 25, overlapChars: 5 }
  );
  assert.equal(chunks[0]?.content, "one two three four five");
  assert.equal(chunks.at(-1)?.content, "short answer");
  assert.equal(chunks.at(-1)?.metadata.page, 2);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 25));
});

test("normalizes text to NFC so decomposed accents match composed ones", () => {
  const [chunk] = chunkKnowledge([{ metadata: {}, text: "extraccio\u0301n de nin\u0303o" }]);
  assert.equal(chunk?.content, "extracci\u00f3n de ni\u00f1o");
});

test("never splits surrogate pairs when chunking non-BMP text", () => {
  const text = "😀".repeat(40);
  for (const options of [
    { maxChars: 7, overlapChars: 3 },
    { maxChars: 10, overlapChars: 5 },
    { maxChars: 3, overlapChars: 1 },
    { maxChars: 2, overlapChars: 1 },
  ]) {
    const chunks = chunkKnowledge([{ metadata: {}, text }], options);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(!LONE_SURROGATE.test(chunk.content), JSON.stringify(options));
    }
  }
});

test("chunks Spanish text on word boundaries without losing accents", () => {
  const text = "¿Cuál es su horario de atención? Abrimos de lunes a viernes. ".repeat(10);
  const chunks = chunkKnowledge([{ metadata: {}, text }], { maxChars: 100, overlapChars: 20 });
  assert.ok(chunks.length > 1);
  assert.ok(
    chunks.every((chunk) => !LONE_SURROGATE.test(chunk.content) && chunk.content.length <= 100)
  );
  assert.ok(chunks[0]?.content.includes("¿Cuál es su horario de atención?"));
});

test("validates chunk options and hashes content plus citation metadata", () => {
  for (const options of [
    { maxChars: 0 },
    { maxChars: 10, overlapChars: 10 },
    { overlapChars: -1 },
    { maxChars: 1.5 },
  ]) {
    assert.throws(() => chunkKnowledge([], options), CHUNK_SIZES);
  }
  const document = { metadata: { title: "Hours" }, text: "At nine" };
  const hash = knowledgeContentHash([document], MODEL);
  assert.equal(hash, knowledgeContentHash([document], MODEL));
  assert.equal(hash, knowledgeContentHash([document], MODEL, { maxChars: 1600 }));
  for (const changed of [
    knowledgeContentHash([{ ...document, text: "At ten" }], MODEL),
    knowledgeContentHash([{ ...document, metadata: { title: "Opening hours" } }], MODEL),
    knowledgeContentHash([document], "google/gemini-embedding-001"),
    knowledgeContentHash([document], MODEL, { maxChars: 800 }),
    knowledgeContentHash([document], MODEL, { overlapChars: 120 }),
  ]) {
    assert.notEqual(hash, changed);
  }
});
