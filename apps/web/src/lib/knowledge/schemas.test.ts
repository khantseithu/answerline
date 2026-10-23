import assert from "node:assert/strict";
import { test } from "node:test";
import { createKnowledgeSource, MAX_QA_PAIRS } from "./schemas.ts";

const parse = (input: unknown) => createKnowledgeSource.safeParse(input);

test("normalizes http(s) URLs and drops blank titles", () => {
  const result = parse({ title: "  ", type: "url", url: "https://Example.com/a b" });
  assert.ok(result.success);
  assert.deepEqual(result.data, {
    title: undefined,
    type: "url",
    url: "https://example.com/a%20b",
  });
});

test("rejects non-http URLs and URLs with credentials", () => {
  assert.equal(parse({ type: "url", url: "javascript:alert(1)" }).success, false);
  assert.equal(parse({ type: "url", url: "file:///etc/passwd" }).success, false);
  assert.equal(parse({ type: "url", url: "https://user:pass@example.com" }).success, false);
  assert.equal(parse({ type: "url", url: "not a url" }).success, false);
});

test("requires a title and content for text sources", () => {
  assert.ok(parse({ content: " We open at nine ", title: "Hours", type: "text" }).success);
  assert.equal(parse({ content: "x", title: "", type: "text" }).success, false);
  assert.equal(parse({ content: "   ", title: "Hours", type: "text" }).success, false);
});

test("reuses the shared Q&A pair schema with a size cap", () => {
  const pair = { answer: " Yes ", question: " Open? " };
  const result = parse({ pairs: [pair], title: "FAQ", type: "qa" });
  assert.ok(result.success);
  assert.deepEqual(result.data, {
    pairs: [{ answer: "Yes", question: "Open?" }],
    title: "FAQ",
    type: "qa",
  });
  assert.equal(parse({ pairs: [], title: "FAQ", type: "qa" }).success, false);
  assert.equal(
    parse({ pairs: [{ answer: "", question: "Q" }], title: "FAQ", type: "qa" }).success,
    false
  );
  assert.equal(
    parse({ pairs: Array.from({ length: MAX_QA_PAIRS + 1 }, () => pair), title: "FAQ", type: "qa" })
      .success,
    false
  );
});

test("rejects unknown types and extra fields", () => {
  assert.equal(parse({ type: "file" }).success, false);
  assert.equal(parse({ content: "c", extra: 1, title: "t", type: "text" }).success, false);
});
