import { z } from "zod";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";
import type { WorkspaceAccess } from "@/lib/workspaces/permissions";
import {
  AgentBadRequestError,
  AgentConflictError,
  type AgentDeps,
  AgentNotFoundError,
  archiveAgent,
  createAgent,
  getAgent,
  listAgents,
  listAgentVersions,
  updateAgent,
} from "./service";
import { listAgentTemplates } from "./templates";

const noStore = { "Cache-Control": "no-store" };

function agentErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request", issues: error.issues },
      { headers: noStore, status: 400 }
    );
  }
  if (error instanceof AgentNotFoundError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 404 });
  }
  if (error instanceof AgentConflictError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 409 });
  }
  if (error instanceof AgentBadRequestError) {
    return Response.json({ error: error.message }, { headers: noStore, status: 400 });
  }
  return null;
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    throw new AgentBadRequestError("Request body must be JSON", { cause: error });
  }
}

export function createAgentHandlers(getDeps: (access?: WorkspaceAccess) => Promise<AgentDeps>) {
  return {
    async create(request: Request) {
      try {
        const deps = await getDeps("write");
        return Response.json(await createAgent(deps, await readJson(request)), {
          headers: noStore,
          status: 201,
        });
      } catch (error) {
        return agentErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
    async delete(rawId: string) {
      try {
        await archiveAgent(await getDeps("write"), rawId);
        return new Response(null, { headers: noStore, status: 204 });
      } catch (error) {
        return agentErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
    async detail(rawId: string) {
      try {
        return Response.json(await getAgent(await getDeps(), rawId), { headers: noStore });
      } catch (error) {
        return agentErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
    async list() {
      try {
        return Response.json(await listAgents(await getDeps()), { headers: noStore });
      } catch (error) {
        return dashboardErrorResponse(error);
      }
    },
    async templates() {
      try {
        await getDeps();
        return Response.json(await listAgentTemplates(), { headers: noStore });
      } catch (error) {
        return agentErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
    async update(request: Request, rawId: string) {
      try {
        const deps = await getDeps("write");
        return Response.json(await updateAgent(deps, rawId, await readJson(request)), {
          headers: noStore,
        });
      } catch (error) {
        return agentErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
    async versions(rawId: string) {
      try {
        return Response.json(await listAgentVersions(await getDeps(), rawId), { headers: noStore });
      } catch (error) {
        return agentErrorResponse(error) ?? dashboardErrorResponse(error);
      }
    },
  };
}
