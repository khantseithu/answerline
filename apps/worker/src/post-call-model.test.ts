import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePostCallAnalysis } from "./post-call-model.ts";

const PROVIDER_FAILURE_PATTERN = /All LLM providers failed/;
const TRANSCRIPT_LEAK_PATTERN = /caller transcript/;

const analysis = {
  outcome: "resolved",
  sentiment: "positive",
  summary: "The caller asked about hours.",
};

function completion(content: string) {
  return Promise.resolve(Response.json({ choices: [{ message: { content } }] }));
}

test("uses the OpenAI-compatible chat completions request and validates its JSON response", async () => {
  let requestedUrl = "";
  const fetch: typeof globalThis.fetch = (input, init) => {
    requestedUrl = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    const requestBody = JSON.parse(String(init?.body));
    assert.equal(requestBody.model, "gpt-4.1-mini");
    assert.equal(requestBody.response_format.type, "json_object");
    return completion(JSON.stringify(analysis));
  };

  const result = await generatePostCallAnalysis(["openai/gpt-4.1-mini"], "caller: hours?", {
    env: { OPENAI_API_KEY: "test-key" },
    fetch,
  });

  assert.equal(requestedUrl, "https://api.openai.com/v1/chat/completions");
  assert.deepEqual(result, analysis);
});

test("uses Google GenerateContent with the configured API key", async () => {
  const fetch: typeof globalThis.fetch = (input, init) => {
    assert.equal(
      String(input),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "google-test");
    const requestBody = JSON.parse(String(init?.body));
    assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
    return Promise.resolve(
      Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }] })
    );
  };

  assert.deepEqual(
    await generatePostCallAnalysis(["google/gemini-2.5-flash"], "input", {
      env: { GOOGLE_API_KEY: "google-test" },
      fetch,
    }),
    analysis
  );
});

test("uses Anthropic Messages with its API headers", async () => {
  const fetch: typeof globalThis.fetch = (input, init) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/messages");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-api-key"), "anthropic-test");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    return Promise.resolve(
      Response.json({ content: [{ text: JSON.stringify(analysis), type: "text" }] })
    );
  };

  assert.deepEqual(
    await generatePostCallAnalysis(["anthropic/claude-haiku"], "input", {
      env: { ANTHROPIC_API_KEY: "anthropic-test" },
      fetch,
    }),
    analysis
  );
});

test("falls back to the next provider after an HTTP failure without reading its body", async () => {
  const attempted: string[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    const url = String(input);
    attempted.push(url);
    return Promise.resolve(
      url.includes("api.openai.com")
        ? new Response("private provider error body", { status: 503 })
        : Response.json({
            candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }],
          })
    );
  };

  const result = await generatePostCallAnalysis(
    ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"],
    "input",
    { env: { GOOGLE_API_KEY: "google-test", OPENAI_API_KEY: "openai-test" }, fetch }
  );

  assert.deepEqual(result, analysis);
  assert.equal(attempted.length, 2);
});

test("rejects invalid analysis JSON without including provider output in the error", async () => {
  const fetch: typeof globalThis.fetch = () => completion("caller transcript should not appear");

  await assert.rejects(
    generatePostCallAnalysis(["openai/gpt-4.1-mini"], "input", {
      env: { OPENAI_API_KEY: "test-key" },
      fetch,
    }),
    (error: Error) => {
      assert.doesNotMatch(error.message, TRANSCRIPT_LEAK_PATTERN);
      return true;
    }
  );
});

test("fails within the configured timeout", async () => {
  const fetch: typeof globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });

  await assert.rejects(
    generatePostCallAnalysis(["openai/gpt-4.1-mini"], "input", {
      env: { OPENAI_API_KEY: "test-key" },
      fetch,
      timeoutMs: 5,
    }),
    PROVIDER_FAILURE_PATTERN
  );
});

test("truncates model input and fails honestly when credentials are missing", async () => {
  let inputLength = 0;
  const fetch: typeof globalThis.fetch = (_input, init) => {
    const requestBody = JSON.parse(String(init?.body));
    inputLength = requestBody.messages[1].content.length;
    return completion(JSON.stringify(analysis));
  };

  await generatePostCallAnalysis(["openai/gpt-4.1-mini"], "x".repeat(25_000), {
    env: { OPENAI_API_KEY: "test-key" },
    fetch,
  });
  assert.equal(inputLength, 24_000);

  await assert.rejects(
    generatePostCallAnalysis(["openai/gpt-4.1-mini"], "input", { env: {} }),
    PROVIDER_FAILURE_PATTERN
  );
});
