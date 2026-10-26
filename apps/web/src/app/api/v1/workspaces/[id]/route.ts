import { workspaceHandlers } from "@/lib/workspaces/context";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceHandlers.settings((await params).id);
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceHandlers.update(request, (await params).id);
}
