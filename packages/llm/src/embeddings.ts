import { z } from "zod";
import { parseModelRef } from "./index.ts";

export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_PROVIDERS = ["openai", "google", "ollama"] as const;

const WHITESPACE = /\s/;
const TRAILING_SLASH = /\/$/;

export function parseEmbeddingModelRef(ref: string) {
  const parsed = parseModelRef(ref);
  if (
    (parsed.provider !== "openai" &&
      parsed.provider !== "google" &&
      parsed.provider !== "ollama") ||
    WHITESPACE.test(ref)
  ) {
    throw new Error(`Unsupported embedding model ref: ${ref}`);
  }
  return { model: parsed.model, provider: parsed.provider };
}

export const embeddingEnvSchema = z.object({
  EMBEDDING_MODEL: z
    .string()
    .refine((ref) => {
      try {
        parseEmbeddingModelRef(ref);
        return true;
      } catch {
        return false;
      }
    }, "Expected an openai, google, or ollama embedding model ref")
    .default(DEFAULT_EMBEDDING_MODEL),
  GOOGLE_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  OPENAI_API_KEY: z.string().optional(),
});

export function embeddingConfigFromEnv(source: NodeJS.ProcessEnv) {
  const env = embeddingEnvSchema.parse(source);
  const { provider } = parseEmbeddingModelRef(env.EMBEDDING_MODEL);
  return {
    apiKey: provider === "openai" ? env.OPENAI_API_KEY : env.GOOGLE_API_KEY,
    baseUrl: provider === "ollama" ? env.OLLAMA_BASE_URL : undefined,
    modelRef: env.EMBEDDING_MODEL,
  };
}

export interface EmbeddingOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  modelRef?: string;
  timeoutMs?: number;
}

export interface EmbeddingProvider {
  readonly dimensions: typeof EMBEDDING_DIMENSIONS;
  embed: (texts: readonly string[]) => Promise<number[][]>;
  readonly modelRef: string;
}

const vectorSchema = z.array(z.number().finite());
const openaiSchema = z.object({
  data: z.array(z.object({ embedding: vectorSchema, index: z.number().int().nonnegative() })),
});
const googleSchema = z.object({ embeddings: z.array(z.object({ values: vectorSchema })) });
const ollamaSchema = z.object({ embeddings: z.array(vectorSchema) });

function normalize(vector: number[]) {
  if (vector.length < EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding model returned ${vector.length} dimensions; need at least 1536`);
  }
  const reduced = vector.slice(0, EMBEDDING_DIMENSIONS);
  const norm = Math.hypot(...reduced);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("Embedding model returned a zero or invalid vector");
  }
  return reduced.map((value) => value / norm);
}

export function createEmbeddingProvider(options: EmbeddingOptions = {}): EmbeddingProvider {
  const modelRef = options.modelRef ?? DEFAULT_EMBEDDING_MODEL;
  const { model, provider } = parseEmbeddingModelRef(modelRef);
  if (provider !== "ollama" && !options.apiKey?.trim()) {
    throw new Error(`Missing API key for embedding provider ${provider}`);
  }
  const timeoutMs = z
    .number()
    .int()
    .positive()
    .parse(options.timeoutMs ?? 10_000);
  const defaultUrl = {
    google: "https://generativelanguage.googleapis.com/v1beta",
    ollama: "http://localhost:11434",
    openai: "https://api.openai.com/v1",
  };
  const baseUrl = z
    .url()
    .parse(options.baseUrl ?? defaultUrl[provider])
    .replace(TRAILING_SLASH, "");
  const request = options.fetch ?? globalThis.fetch;

  async function embedBatch(texts: readonly string[]) {
    let path: string;
    let body: unknown;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider === "openai") {
      path = "/embeddings";
      headers.Authorization = `Bearer ${options.apiKey}`;
      body = {
        ...(model.startsWith("text-embedding-3-") ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
        encoding_format: "float",
        input: texts,
        model,
      };
    } else if (provider === "google") {
      path = `/models/${encodeURIComponent(model)}:batchEmbedContents`;
      headers["x-goog-api-key"] = options.apiKey ?? "";
      body = {
        requests: texts.map((text) => ({
          content: { parts: [{ text }] },
          model: `models/${model}`,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      };
    } else {
      path = "/api/embed";
      body = { dimensions: EMBEDDING_DIMENSIONS, input: texts, model, truncate: false };
    }
    const response = await request(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed (${modelRef}; HTTP ${response.status})`);
    }
    const payload: unknown = await response.json();
    let vectors: number[][];
    if (provider === "openai") {
      const { data } = openaiSchema.parse(payload);
      const indices = new Set(data.map((item) => item.index));
      if (indices.size !== texts.length || data.some((item) => item.index >= texts.length)) {
        throw new Error("Embedding response has missing or duplicate indices");
      }
      vectors = data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    } else if (provider === "google") {
      vectors = googleSchema.parse(payload).embeddings.map((item) => item.values);
    } else {
      vectors = ollamaSchema.parse(payload).embeddings;
    }
    if (vectors.length !== texts.length) {
      throw new Error(
        `Embedding response count mismatch: expected ${texts.length}, got ${vectors.length}`
      );
    }
    return vectors.map(normalize);
  }

  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      z.array(z.string().trim().min(1)).parse(texts);
      const batches = Array.from({ length: Math.ceil(texts.length / 100) }, (_, i) =>
        texts.slice(i * 100, (i + 1) * 100)
      );
      return await batches.reduce<Promise<number[][]>>(
        (pending, batch) =>
          pending.then(async (vectors) => vectors.concat(await embedBatch(batch))),
        Promise.resolve([])
      );
    },
    modelRef,
  };
}
