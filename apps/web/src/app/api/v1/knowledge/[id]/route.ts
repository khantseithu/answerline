import { getKnowledgeDeps } from "@/lib/knowledge/context";
import { createKnowledgeHandlers } from "@/lib/knowledge/handlers";

const handlers = createKnowledgeHandlers(getKnowledgeDeps);

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/knowledge/[id]">) {
  const { id } = await ctx.params;
  return handlers.remove(request, id);
}
