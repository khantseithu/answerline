export {
  createEmbeddingProvider,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDERS,
  type EmbeddingOptions,
  type EmbeddingProvider,
  embeddingConfigFromEnv,
  embeddingEnvSchema,
  parseEmbeddingModelRef,
} from "./embeddings.ts";

export const PROVIDERS = ["anthropic", "openai", "google", "deepseek", "ollama"] as const;

export type Provider = (typeof PROVIDERS)[number];

export interface ModelRef {
  model: string;
  provider: Provider;
}

export function parseModelRef(ref: string): ModelRef {
  const [provider, ...rest] = ref.split("/");
  const model = rest.join("/");
  if (!(provider && model && PROVIDERS.includes(provider as Provider))) {
    throw new Error(`Unsupported model ref: ${ref}`);
  }
  return { model, provider: provider as Provider };
}

export class AllProvidersFailedError extends Error {
  readonly failures: { ref: string; error: unknown }[];

  constructor(failures: { ref: string; error: unknown }[]) {
    super(`All LLM providers failed: ${failures.map((f) => f.ref).join(", ")}`);
    this.failures = failures;
  }
}

export async function withFallback<T>(
  refs: string[],
  call: (model: ModelRef) => Promise<T>
): Promise<{ ref: string; result: T }> {
  const failures: { ref: string; error: unknown }[] = [];
  for (const ref of refs) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: fallback must try providers in order
      return { ref, result: await call(parseModelRef(ref)) };
    } catch (error) {
      failures.push({ error, ref });
    }
  }
  throw new AllProvidersFailedError(failures);
}
