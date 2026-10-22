import { parse } from "yaml";
import { z } from "zod";

export const evalCaseSchema = z.object({
  name: z.string().min(1),
  caller: z.string().min(1),
  expect: z.object({
    tool_called: z.string().optional(),
    mentions: z.array(z.string()).optional(),
    not_mentions: z.array(z.string()).optional(),
    judge: z.string().optional(),
  }),
});

export const evalSuiteSchema = z.array(evalCaseSchema).min(1);

export type EvalCase = z.infer<typeof evalCaseSchema>;

export function parseEvalSuite(source: string): EvalCase[] {
  return evalSuiteSchema.parse(parse(source));
}
