import { z } from "zod";
import { agentConfigSchema } from "./agent-config.ts";

export const callIdSchema = z.uuid();
export const agentIdSchema = z.uuid();
export const templateSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

export const callsListQuerySchema = z
  .object({
    agentId: agentIdSchema.optional(),
    channel: z.enum(["web", "sip"]).optional(),
    from: z.iso.date().optional(),
    outcome: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(500).optional(),
    to: z.iso.date().optional(),
  })
  .refine((query) => !(query.from && query.to) || query.from <= query.to, {
    message: "From date must be on or before to date",
    path: ["to"],
  });

export const createAgentSchema = z.object({
  config: agentConfigSchema.strict(),
  slug: templateSlugSchema,
});
export const updateAgentSchema = z.object({
  config: agentConfigSchema.strict(),
  version: z.int().positive(),
});

export const agentViewSchema = z.object({
  config: agentConfigSchema,
  id: agentIdSchema,
  name: z.string().min(1),
  slug: templateSlugSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.int().positive(),
});
export const agentVersionViewSchema = z.object({
  config: agentConfigSchema,
  createdAt: z.iso.datetime({ offset: true }),
  version: z.int().positive(),
});
export const agentTemplateSchema = z.object({
  config: agentConfigSchema,
  slug: templateSlugSchema,
});

export const postCallJobSchema = z.object({ callId: callIdSchema, tenantId: z.uuid() });
export const postCallAnalysisSchema = z.object({
  outcome: z.enum([
    "booked",
    "transferred",
    "voicemail",
    "follow_up",
    "resolved",
    "unresolved",
    "failed",
    "unknown",
  ]),
  sentiment: z.enum(["positive", "neutral", "negative", "unknown"]),
  summary: z.string().trim().min(1).max(4000),
});

export type CallsListQuery = z.infer<typeof callsListQuerySchema>;
export type CreateAgent = z.infer<typeof createAgentSchema>;
export type UpdateAgent = z.infer<typeof updateAgentSchema>;
export type PostCallJob = z.infer<typeof postCallJobSchema>;
export type PostCallAnalysis = z.infer<typeof postCallAnalysisSchema>;

export type AgentView = z.infer<typeof agentViewSchema>;
export type AgentVersionView = z.infer<typeof agentVersionViewSchema>;
export type AgentTemplate = z.infer<typeof agentTemplateSchema>;
