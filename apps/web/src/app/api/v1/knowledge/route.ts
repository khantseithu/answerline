import { connection } from "next/server";
import { getKnowledgeDeps } from "@/lib/knowledge/context";
import { createKnowledgeHandlers } from "@/lib/knowledge/handlers";

const handlers = createKnowledgeHandlers(getKnowledgeDeps);

export async function GET() {
  await connection();
  return handlers.list();
}

export function POST(request: Request) {
  return handlers.create(request);
}
