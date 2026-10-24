import { getPhoneNumberDeps } from "@/lib/phone-numbers/context";
import { createPhoneNumberHandlers } from "@/lib/phone-numbers/handlers";

const handlers = createPhoneNumberHandlers(getPhoneNumberDeps);

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/phone-numbers/[number]">) {
  const { number } = await ctx.params;
  return handlers.assign(request, number);
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/phone-numbers/[number]">
) {
  const { number } = await ctx.params;
  return handlers.remove(request, number);
}
