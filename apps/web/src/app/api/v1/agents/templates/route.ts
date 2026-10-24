import { getAgentDeps } from "@/lib/agents/context";
import { createAgentHandlers } from "@/lib/agents/handlers";

const handlers = createAgentHandlers(getAgentDeps);

export function GET() {
  return handlers.templates();
}
