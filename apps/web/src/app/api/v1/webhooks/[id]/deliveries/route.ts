import { webhookHandlers } from "@/lib/webhooks/context";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/webhooks/[id]/deliveries">
) {
  const { id } = await params;
  return webhookHandlers.deliveries(request, id);
}
