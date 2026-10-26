import { workspaceHandlers } from "@/lib/workspaces/context";
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/invitations/[invitationId]">
) {
  const { id, invitationId } = await ctx.params;
  return workspaceHandlers.revoke(request, id, invitationId);
}
