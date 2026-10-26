import { apiKeyHandlers } from "@/lib/api-keys/context";

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/api-keys/[keyId]">
) {
  const { id, keyId } = await ctx.params;
  return apiKeyHandlers.revoke(request, id, keyId);
}
