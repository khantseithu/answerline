import { callsListQuerySchema } from "@answerline/shared";

export function parseCallsQuery(input: Record<string, string | string[] | undefined>) {
  const normalized = Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      if (value === undefined || Array.isArray(value) || value === "") {
        return [];
      }
      return [[key, value]];
    })
  );
  return callsListQuerySchema.safeParse(normalized);
}
