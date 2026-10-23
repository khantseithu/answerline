import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkKnowledge, knowledgeContentHash } from "./knowledge-chunks.ts";

const CHUNK_SIZES = /Chunk sizes/;

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
  assert.equal(knowledgeContentHash([document]), knowledgeContentHash([document]));
  assert.notEqual(
    knowledgeContentHash([document]),
    knowledgeContentHash([{ ...document, text: "At ten" }])
  );
  assert.notEqual(
    knowledgeContentHash([document]),
    knowledgeContentHash([{ ...document, metadata: { title: "Opening hours" } }])
  );
});
