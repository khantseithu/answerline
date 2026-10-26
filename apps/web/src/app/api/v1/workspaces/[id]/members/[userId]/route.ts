import { workspaceHandlers } from "@/lib/workspaces/context";
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/members/[userId]">
) {
  const { id, userId } = await ctx.params;
  return workspaceHandlers.member(request, id, userId);
}
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/members/[userId]">
) {
  const { id, userId } = await ctx.params;
  return workspaceHandlers.removeMember(request, id, userId);
}
