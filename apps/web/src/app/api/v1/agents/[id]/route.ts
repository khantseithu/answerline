import { getAgentDeps } from "@/lib/agents/context";
import { createAgentHandlers } from "@/lib/agents/handlers";

const handlers = createAgentHandlers(getAgentDeps);

export async function GET(_request: Request, ctx: RouteContext<"/api/v1/agents/[id]">) {
  const { id } = await ctx.params;
  return handlers.detail(id);
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/agents/[id]">) {
  const { id } = await ctx.params;
  return handlers.update(request, id);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/v1/agents/[id]">) {
  const { id } = await ctx.params;
  return handlers.delete(id);
}
