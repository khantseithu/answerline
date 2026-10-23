import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEmbeddingProvider,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  embeddingConfigFromEnv,
  embeddingEnvSchema,
  parseEmbeddingModelRef,
} from "./index.ts";

const SHORT_VECTOR = /768 dimensions; need at least 1536/;
const COUNT_MISMATCH = /count mismatch/;
const MISSING_KEY = /Missing API key/;
const HTTP_ERROR = /HTTP 429/;
const NETWORK_ERROR = /network down/;

const vector = (size = 1536, value = 1) => Array.from({ length: size }, () => value);
const mockFetch = (handler: (url: string, init: RequestInit) => Response) => {
  const fetch: typeof globalThis.fetch = async (url, init) => handler(String(url), init ?? {});
  return fetch;
};
const openai = (embeddings: number[][]) => ({
  data: embeddings.map((embedding, index) => ({ embedding, index })),
});
const unitVector = (embedding: number[]) => {
  assert.equal(embedding.length, EMBEDDING_DIMENSIONS);
  assert.ok(Math.abs(Math.hypot(...embedding) - 1) < 1e-12);
};

test("embedding model refs and typed env default to OpenAI", () => {
  assert.equal(embeddingEnvSchema.parse({}).EMBEDDING_MODEL, DEFAULT_EMBEDDING_MODEL);
  assert.deepEqual(embeddingConfigFromEnv({ OPENAI_API_KEY: "test" }), {
    apiKey: "test",
    baseUrl: undefined,
    modelRef: DEFAULT_EMBEDDING_MODEL,
  });
  assert.equal(parseEmbeddingModelRef("ollama/org/model:tag").model, "org/model:tag");
  for (const ref of ["anthropic/a", "gemini/a", "openai/", "openai/a b"]) {
    assert.throws(() => parseEmbeddingModelRef(ref));
    assert.throws(() => embeddingEnvSchema.parse({ EMBEDDING_MODEL: ref }));
  }
  assert.equal(
    embeddingConfigFromEnv({ EMBEDDING_MODEL: "google/gemini-embedding-001", GOOGLE_API_KEY: "g" })
      .apiKey,
    "g"
  );
  assert.deepEqual(
    embeddingConfigFromEnv({
      EMBEDDING_MODEL: "ollama/qwen3-embedding:4b",
      GOOGLE_API_KEY: "g",
      OLLAMA_BASE_URL: "http://local:11434",
    }),
    { apiKey: undefined, baseUrl: "http://local:11434", modelRef: "ollama/qwen3-embedding:4b" }
  );
  assert.throws(() => embeddingEnvSchema.parse({ OLLAMA_BASE_URL: "invalid" }));
});

test("OpenAI requests dimensions and restores batch order", async () => {
  const provider = createEmbeddingProvider({
    apiKey: "test",
    fetch: mockFetch((url, init) => {
      assert.equal(url, "https://api.openai.com/v1/embeddings");
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer test");
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(String(init.body)), {
        dimensions: 1536,
        encoding_format: "float",
        input: ["first", "second"],
        model: "text-embedding-3-small",
      });
      return Response.json({
        data: [
          { embedding: vector(1536, -1), index: 1 },
          { embedding: vector(), index: 0 },
        ],
      });
    }),
  });
  const result = await provider.embed(["first", "second"]);
  assert.equal(provider.dimensions, 1536);
  assert.equal(provider.modelRef, DEFAULT_EMBEDDING_MODEL);
  result.forEach(unitVector);
  assert.ok((result[0]?.[0] ?? 0) > 0);
  assert.ok((result[1]?.[0] ?? 0) < 0);
});

test("legacy OpenAI models omit unsupported native dimensions", async () => {
  await createEmbeddingProvider({
    apiKey: "test",
    fetch: mockFetch((_url, init) => {
      assert.equal(JSON.parse(String(init.body)).dimensions, undefined);
      return Response.json(openai([vector()]));
    }),
    modelRef: "openai/text-embedding-ada-002",
  }).embed(["text"]);
});

test("Gemini requests native output dimensions for every batch item", async () => {
  const result = await createEmbeddingProvider({
    apiKey: "google-test",
    fetch: mockFetch((url, init) => {
      assert.equal(
        url,
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents"
      );
      assert.equal(new Headers(init.headers).get("x-goog-api-key"), "google-test");
      assert.deepEqual(JSON.parse(String(init.body)), {
        requests: ["a", "b"].map((text) => ({
          content: { parts: [{ text }] },
          model: "models/gemini-embedding-001",
          outputDimensionality: 1536,
        })),
      });
      return Response.json({ embeddings: [{ values: vector() }, { values: vector(3072, -2) }] });
    }),
    modelRef: "google/gemini-embedding-001",
  }).embed(["a", "b"]);
  result.forEach(unitVector);
});

test("Ollama truncates then normalizes, without silently truncating text", async () => {
  const raw = [...vector(1536, 2), ...vector(1024, 100)];
  const result = await createEmbeddingProvider({
    baseUrl: "http://local:11434/",
    fetch: mockFetch((url, init) => {
      assert.equal(url, "http://local:11434/api/embed");
      assert.equal(new Headers(init.headers).has("authorization"), false);
      assert.deepEqual(JSON.parse(String(init.body)), {
        dimensions: 1536,
        input: ["a"],
        model: "qwen3-embedding:4b",
        truncate: false,
      });
      return Response.json({ embeddings: [raw] });
    }),
    modelRef: "ollama/qwen3-embedding:4b",
  }).embed(["a"]);
  result.forEach(unitVector);
  assert.ok(Math.abs((result[0]?.[0] ?? 0) - 1 / Math.sqrt(1536)) < 1e-12);
});

test("large batches are bounded and empty input makes no HTTP request", async () => {
  const sizes: number[] = [];
  const provider = createEmbeddingProvider({
    apiKey: "test",
    fetch: mockFetch((_url, init) => {
      const input: string[] = JSON.parse(String(init.body)).input;
      sizes.push(input.length);
      return Response.json(openai(input.map(() => vector())));
    }),
  });
  assert.deepEqual(await provider.embed([]), []);
  assert.deepEqual(sizes, []);
  const result = await provider.embed(Array.from({ length: 101 }, (_, i) => `text ${i}`));
  assert.deepEqual(sizes, [100, 1]);
  assert.equal(result.length, 101);
  await assert.rejects(provider.embed([" "]));
});

test("rejects short, zero, non-finite, malformed and mismatched responses", async () => {
  const payloads: unknown[] = [
    openai([vector(768)]),
    openai([vector(1536, 0)]),
    openai([[...vector(1535), Number.NaN]]),
    { data: [{ embedding: vector().map(String), index: 0 }] },
    { data: [{ embedding: vector(), index: 1 }] },
    {
      data: [
        { embedding: vector(), index: 0 },
        { embedding: vector(), index: 0 },
      ],
    },
    { data: [] },
    {},
  ];
  await Promise.all(
    payloads.map((payload) =>
      assert.rejects(
        createEmbeddingProvider({
          apiKey: "test",
          fetch: mockFetch(() => Response.json(payload)),
        }).embed(["text"])
      )
    )
  );
  await assert.rejects(
    createEmbeddingProvider({
      fetch: mockFetch(() => Response.json({ embeddings: [vector(768)] })),
      modelRef: "ollama/small",
    }).embed(["text"]),
    SHORT_VECTOR
  );
  await assert.rejects(
    createEmbeddingProvider({
      apiKey: "test",
      fetch: mockFetch(() => Response.json({ embeddings: [] })),
      modelRef: "google/gemini-embedding-001",
    }).embed(["text"]),
    COUNT_MISMATCH
  );
});

test("fails clearly for missing credentials, HTTP failures, transport failures and timeouts", async () => {
  assert.throws(() => createEmbeddingProvider(), MISSING_KEY);
  assert.throws(() => createEmbeddingProvider({ apiKey: " " }), MISSING_KEY);
  assert.throws(() => createEmbeddingProvider({ modelRef: "anthropic/model" }));
  assert.throws(() => createEmbeddingProvider({ apiKey: "test", timeoutMs: 0 }));
  await assert.rejects(
    createEmbeddingProvider({
      apiKey: "test",
      fetch: mockFetch(() => new Response("sensitive provider error", { status: 429 })),
    }).embed(["text"]),
    HTTP_ERROR
  );
  const fetch: typeof globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  await assert.rejects(
    createEmbeddingProvider({ apiKey: "test", fetch }).embed(["text"]),
    NETWORK_ERROR
  );
  const timeoutFetch: typeof globalThis.fetch = async (_url, init) => {
    await new Promise<void>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      setTimeout(() => reject(new Error("timeout signal did not fire")), 100);
    });
    return Response.json({});
  };
  await assert.rejects(
    createEmbeddingProvider({ apiKey: "test", fetch: timeoutFetch, timeoutMs: 1 }).embed(["text"]),
    { name: "TimeoutError" }
  );
});
