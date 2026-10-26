import { workspaceHandlers } from "@/lib/workspaces/context";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  return workspaceHandlers.member(request, id, userId);
}
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  return workspaceHandlers.removeMember(id, userId);
}
