import { webhookHandlers } from "@/lib/webhooks/context";

export function GET() {
  return webhookHandlers.list();
}

export function POST(request: Request) {
  return webhookHandlers.create(request);
}
