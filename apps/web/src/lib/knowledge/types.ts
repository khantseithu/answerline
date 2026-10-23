import { z } from "zod";

export const knowledgeSourceView = z.object({
  createdAt: z.string(),
  error: z.string().nullable(),
  id: z.string(),
  ingestedAt: z.string().nullable(),
  itemCount: z.number().nullable(),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  title: z.string().nullable(),
  type: z.enum(["url", "file", "qa", "text"]),
  uri: z.string().nullable(),
});

export const knowledgeSourceList = z.object({ sources: z.array(knowledgeSourceView) });

export type KnowledgeSourceView = z.infer<typeof knowledgeSourceView>;
export type KnowledgeSourceType = KnowledgeSourceView["type"];
export type KnowledgeSourceStatus = KnowledgeSourceView["status"];

export const isInFlight = (status: KnowledgeSourceStatus) =>
  status === "pending" || status === "processing";
