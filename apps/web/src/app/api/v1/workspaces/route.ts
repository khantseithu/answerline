import { workspaceHandlers } from "@/lib/workspaces/context";
export function GET() {
  return workspaceHandlers.list();
}
export function POST(request: Request) {
  return workspaceHandlers.create(request);
}
