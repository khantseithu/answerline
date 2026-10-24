import { z } from "zod";

export const evalRunStatus = z.enum(["queued", "running", "completed", "failed"]);

export const evalRunView = z.object({
  agentId: z.string(),
  agentName: z.string(),
  avgLatencyMs: z.number().nullable(),
  costUsd: z.string().nullable(),
  createdAt: z.string(),
  error: z.string().nullable(),
  finishedAt: z.string().nullable(),
  id: z.string(),
  liveTools: z.boolean(),
  mode: z.enum(["text", "audio"]),
  modelOverride: z.string().nullable(),
  passed: z.number().nullable(),
  startedAt: z.string().nullable(),
  status: evalRunStatus,
  suite: z.string(),
  total: z.number().nullable(),
});

export const evalRunList = z.object({ runs: z.array(evalRunView) });

export type EvalRunView = z.infer<typeof evalRunView>;
export type EvalRunStatus = z.infer<typeof evalRunStatus>;

export const isEvalRunInFlight = (status: EvalRunStatus) =>
  status === "queued" || status === "running";
