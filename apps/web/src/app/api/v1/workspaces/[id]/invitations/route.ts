import { workspaceHandlers } from "@/lib/workspaces/context";
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/invitations">
) {
  return workspaceHandlers.invite(request, (await ctx.params).id);
}
