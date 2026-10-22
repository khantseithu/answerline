export const PROVIDERS = ["anthropic", "openai", "google", "deepseek", "ollama"] as const;

export type Provider = (typeof PROVIDERS)[number];

export interface ModelRef {
  provider: Provider;
  model: string;
}

export function parseModelRef(ref: string): ModelRef {
  const [provider, ...rest] = ref.split("/");
  const model = rest.join("/");
  if (!provider || !model || !PROVIDERS.includes(provider as Provider)) {
    throw new Error(`Unsupported model ref: ${ref}`);
  }
  return { provider: provider as Provider, model };
}

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: { ref: string; error: unknown }[]) {
    super(`All LLM providers failed: ${failures.map((f) => f.ref).join(", ")}`);
  }
}

export async function withFallback<T>(
  refs: string[],
  call: (model: ModelRef) => Promise<T>,
): Promise<{ ref: string; result: T }> {
  const failures: { ref: string; error: unknown }[] = [];
  for (const ref of refs) {
    try {
      return { ref, result: await call(parseModelRef(ref)) };
    } catch (error) {
      failures.push({ ref, error });
    }
  }
  throw new AllProvidersFailedError(failures);
}
