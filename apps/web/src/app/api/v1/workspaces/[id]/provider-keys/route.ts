import { providerKeyHandlers } from "@/lib/provider-keys/context";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/provider-keys">
) {
  return providerKeyHandlers.list((await ctx.params).id);
}

export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/provider-keys">
) {
  return providerKeyHandlers.set(request, (await ctx.params).id);
}
