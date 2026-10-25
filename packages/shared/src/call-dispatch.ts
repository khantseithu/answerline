import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

export const callDispatchMetadataSchema = z.strictObject({
  agent: slug,
  tenant: slug,
});

export type CallDispatchMetadata = z.infer<typeof callDispatchMetadataSchema>;
