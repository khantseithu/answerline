import { getKnowledgeDeps } from "@/lib/knowledge/context";
import { createKnowledgeHandlers } from "@/lib/knowledge/handlers";

const handlers = createKnowledgeHandlers(getKnowledgeDeps);

export async function POST(request: Request, ctx: RouteContext<"/api/v1/knowledge/[id]/sync">) {
  const { id } = await ctx.params;
  return handlers.resync(request, id);
}
