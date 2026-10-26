import { workspaceHandlers } from "@/lib/workspaces/context";
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
) {
  const { id, invitationId } = await params;
  return workspaceHandlers.revoke(id, invitationId);
}
