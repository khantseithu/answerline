import { getKnowledgeDeps } from "@/lib/knowledge/context";
import { createKnowledgeHandlers } from "@/lib/knowledge/handlers";

const handlers = createKnowledgeHandlers(getKnowledgeDeps);

export function POST(request: Request) {
  return handlers.upload(request);
}
