import { workspaceHandlers } from "@/lib/workspaces/context";
export function POST(request: Request) {
  return workspaceHandlers.switch(request);
}
