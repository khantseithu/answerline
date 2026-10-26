import { webhookHandlers } from "@/lib/webhooks/context";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/webhooks/[id]/deliveries/[deliveryId]/replay">
) {
  const { id, deliveryId } = await params;
  return webhookHandlers.replay(request, id, deliveryId);
}
