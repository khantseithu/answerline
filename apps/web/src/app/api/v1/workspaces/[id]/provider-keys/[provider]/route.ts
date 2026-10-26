import { providerKeyHandlers } from "@/lib/provider-keys/context";

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/provider-keys/[provider]">
) {
  const { id, provider } = await ctx.params;
  return providerKeyHandlers.remove(request, id, provider);
}
