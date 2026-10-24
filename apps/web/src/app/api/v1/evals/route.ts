import { connection } from "next/server";
import { getEvalDeps } from "@/lib/evals/context";
import { createEvalHandlers } from "@/lib/evals/handlers";

const handlers = createEvalHandlers(getEvalDeps);

export async function GET() {
  await connection();
  return handlers.list();
}

export function POST(request: Request) {
  return handlers.create(request);
}
