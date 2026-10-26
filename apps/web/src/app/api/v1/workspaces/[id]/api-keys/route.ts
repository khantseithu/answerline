import { apiKeyHandlers } from "@/lib/api-keys/context";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/api-keys">
) {
  return apiKeyHandlers.list((await ctx.params).id);
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/workspaces/[id]/api-keys">
) {
  return apiKeyHandlers.create(request, (await ctx.params).id);
}
