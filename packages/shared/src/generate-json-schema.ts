import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { agentConfigSchema } from "./agent-config.ts";
import { callDispatchMetadataSchema } from "./call-dispatch.ts";
import { callEventJob } from "./call-events.ts";
import {
  evalExecutionInputSchema,
  evalExecutionOutputSchema,
  evalJobSchema,
  evalRunCreateSchema,
  evalSuiteSchema,
} from "./eval-suite.ts";
import { outboundCallRequestSchema, outboundCallResponseSchema } from "./outbound-calls.ts";

const schemas = {
  "agent-config": agentConfigSchema,
  "call-dispatch": callDispatchMetadataSchema,
  "call-event": callEventJob,
  "eval-execution-input": evalExecutionInputSchema,
  "eval-execution-output": evalExecutionOutputSchema,
  "eval-job": evalJobSchema,
  "eval-run-create": evalRunCreateSchema,
  "eval-suite": evalSuiteSchema,
  "outbound-call-request": outboundCallRequestSchema,
  "outbound-call-response": outboundCallResponseSchema,
} as const;

export type SchemaName = keyof typeof schemas;

export const schemaPath = (name: SchemaName) =>
  new URL(`../schema/${name}.schema.json`, import.meta.url);

export function jsonSchema(name: SchemaName) {
  return `${JSON.stringify(z.toJSONSchema(schemas[name], { io: "input" }), null, 2)}\n`;
}

export const AGENT_CONFIG_SCHEMA_PATH = schemaPath("agent-config");

export const agentConfigJsonSchema = () => jsonSchema("agent-config");

if (import.meta.main) {
  const names = Object.keys(schemas) as SchemaName[];
  await Promise.all(names.map((name) => writeFile(schemaPath(name), jsonSchema(name))));
  console.log(`wrote ${names.map((name) => `schema/${name}.schema.json`).join(", ")}`);
}
