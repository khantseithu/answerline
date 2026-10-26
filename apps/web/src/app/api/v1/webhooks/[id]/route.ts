import { webhookHandlers } from "@/lib/webhooks/context";

export async function GET(request: Request, { params }: RouteContext<"/api/v1/webhooks/[id]">) {
  const { id } = await params;
  return webhookHandlers.get(request, id);
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v1/webhooks/[id]">) {
  const { id } = await params;
  return webhookHandlers.update(request, id);
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/v1/webhooks/[id]">) {
  const { id } = await params;
  return webhookHandlers.delete(request, id);
}
