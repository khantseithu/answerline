import { z } from "zod";
import { languageCodeSchema } from "./agent-config.ts";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

export const callDispatchMetadataSchema = z.strictObject({
  agent: slug,
  language: languageCodeSchema.optional(),
  tenant: slug,
});

export type CallDispatchMetadata = z.infer<typeof callDispatchMetadataSchema>;
