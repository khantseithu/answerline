import { agentSlugSchema, phoneNumberSchema } from "@answerline/worker/phone-numbers";
import { z } from "zod";

export const createPhoneNumber = z.strictObject({
  agent: agentSlugSchema,
  number: phoneNumberSchema,
});

export const assignPhoneNumber = z.strictObject({ agent: agentSlugSchema });
