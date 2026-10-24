import { type AgentConfig, agentConfigSchema } from "@answerline/shared";
import { parse } from "yaml";

export type ParsedAgentYaml = { config: AgentConfig; ok: true } | { error: string; ok: false };

export function parseAgentYaml(draft: string): ParsedAgentYaml {
  try {
    const parsed = agentConfigSchema.safeParse(parse(draft));
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid agent configuration",
        ok: false,
      };
    }
    return { config: parsed.data, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid agent configuration",
      ok: false,
    };
  }
}
