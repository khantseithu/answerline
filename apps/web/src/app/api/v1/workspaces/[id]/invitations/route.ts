import { workspaceHandlers } from "@/lib/workspaces/context";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceHandlers.invite(request, (await params).id);
}
