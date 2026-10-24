import { getEvalDeps } from "@/lib/evals/context";
import { createEvalHandlers } from "@/lib/evals/handlers";

const handlers = createEvalHandlers(getEvalDeps);

export async function GET(_request: Request, ctx: RouteContext<"/api/v1/evals/[id]">) {
  const { id } = await ctx.params;
  return handlers.detail(id);
}
