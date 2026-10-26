import { z } from "zod";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";
import type { WorkspaceAccess } from "@/lib/workspaces/permissions";
import {
  createEvalRun,
  EvalBadRequestError,
  type EvalDeps,
  EvalNotFoundError,
  EvalQueueError,
  getEvalRun,
  listEvalRuns,
} from "./service";

const noStore = { "Cache-Control": "no-store" };

function evalErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request", issues: error.issues },
      { headers: noStore, status: 400 }
    );
  }
  if (error instanceof EvalBadRequestError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 400 });
  }
  if (error instanceof EvalNotFoundError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 404 });
  }
  if (error instanceof EvalQueueError) {
    console.error(error);
    return Response.json({ error: error.message }, { headers: noStore, status: 503 });
  }
  return null;
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    throw new EvalBadRequestError("Request body must be JSON", { cause: error });
  }
}

export function createEvalHandlers(getDeps: (access?: WorkspaceAccess) => Promise<EvalDeps>) {
  return {
    async create(request: Request) {
      try {
        const deps = await getDeps("write");
        const run = await createEvalRun(deps, await readJson(request));
        return Response.json({ run }, { headers: noStore, status: 202 });
      } catch (error) {
        return evalErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
    async detail(rawId: string) {
      try {
        const detail = await getEvalRun(await getDeps(), rawId);
        if (!detail) {
          throw new EvalNotFoundError("Eval run not found");
        }
        return Response.json(detail, { headers: noStore });
      } catch (error) {
        return evalErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
    async list() {
      try {
        return Response.json({ runs: await listEvalRuns(await getDeps()) }, { headers: noStore });
      } catch (error) {
        return dashboardErrorResponse(error);
      }
    },
  };
}
