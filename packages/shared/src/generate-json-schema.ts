import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { agentConfigSchema } from "./agent-config.ts";

export const AGENT_CONFIG_SCHEMA_PATH = new URL(
  "../schema/agent-config.schema.json",
  import.meta.url
);

export function agentConfigJsonSchema() {
  return `${JSON.stringify(z.toJSONSchema(agentConfigSchema, { io: "input" }), null, 2)}\n`;
}

if (import.meta.main) {
  await writeFile(AGENT_CONFIG_SCHEMA_PATH, agentConfigJsonSchema());
  console.log("wrote schema/agent-config.schema.json");
}
