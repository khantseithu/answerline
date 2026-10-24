import { getAgentDeps } from "@/lib/agents/context";
import { createAgentHandlers } from "@/lib/agents/handlers";

const handlers = createAgentHandlers(getAgentDeps);

export function GET() {
  return handlers.list();
}

export function POST(request: Request) {
  return handlers.create(request);
}
