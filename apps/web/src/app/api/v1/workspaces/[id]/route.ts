import { workspaceHandlers } from "@/lib/workspaces/context";
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/workspaces/[id]">) {
  return workspaceHandlers.settings((await ctx.params).id);
}
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/workspaces/[id]">) {
  return workspaceHandlers.update(request, (await ctx.params).id);
}
