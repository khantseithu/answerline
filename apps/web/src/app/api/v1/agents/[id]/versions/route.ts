import { getAgentDeps } from "@/lib/agents/context";
import { createAgentHandlers } from "@/lib/agents/handlers";

const handlers = createAgentHandlers(getAgentDeps);

export async function GET(_request: Request, ctx: RouteContext<"/api/v1/agents/[id]/versions">) {
  const { id } = await ctx.params;
  return handlers.versions(id);
}
