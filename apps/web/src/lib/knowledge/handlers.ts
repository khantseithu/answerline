import { z } from "zod";
import {
  DashboardAuthError,
  DashboardForbiddenError,
  dashboardErrorResponse,
  WorkspaceRequiredError,
} from "@/lib/dashboard/errors";
import type { WorkspaceAccess } from "@/lib/workspaces/permissions";
import { assertWorkspaceUsageAvailable, WorkspaceUsageLimitError } from "@/lib/workspaces/usage";
import { MAX_KNOWLEDGE_FILE_BYTES } from "./file-rules";
import { KnowledgeFileError } from "./files";
import { createKnowledgeSource as createKnowledgeSourceInput, knowledgeSourceId } from "./schemas";
import {
  createKnowledgeFileSource,
  createKnowledgeSource,
  deleteKnowledgeSource,
  type KnowledgeDeps,
  KnowledgeNotFoundError,
  KnowledgeQueueError,
  listKnowledgeSources,
  resyncKnowledgeSource,
} from "./service";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export class KnowledgeBadRequestError extends Error {}

const noStore = { "Cache-Control": "no-store" };

export function knowledgeErrorResponse(error: unknown) {
  if (error instanceof WorkspaceUsageLimitError) {
    return dashboardErrorResponse(error);
  }
  if (
    error instanceof DashboardAuthError ||
    error instanceof DashboardForbiddenError ||
    error instanceof WorkspaceRequiredError
  ) {
    return dashboardErrorResponse(error);
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request", issues: error.issues },
      { status: 400 }
    );
  }
  if (error instanceof KnowledgeFileError || error instanceof KnowledgeBadRequestError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof KnowledgeNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof KnowledgeQueueError) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    throw new KnowledgeBadRequestError("Request body must be JSON", { cause: error });
  }
}

export function createKnowledgeHandlers(
  getDeps: (access?: WorkspaceAccess) => Promise<KnowledgeDeps>
) {
  return {
    async create(request: Request) {
      try {
        const deps = await getDeps("write");
        await assertWorkspaceUsageAvailable(deps.db, deps.tenantId);
        const input = createKnowledgeSourceInput.parse(await readJson(request));
        const id = await createKnowledgeSource(deps, input);
        return Response.json({ id }, { headers: noStore, status: 201 });
      } catch (error) {
        return knowledgeErrorResponse(error);
      }
    },
    async list() {
      try {
        const sources = await listKnowledgeSources(await getDeps());
        return Response.json({ sources }, { headers: noStore });
      } catch (error) {
        return knowledgeErrorResponse(error);
      }
    },
    async remove(_request: Request, rawId: string) {
      try {
        const deps = await getDeps("write");
        await deleteKnowledgeSource(deps, knowledgeSourceId.parse(rawId));
        return new Response(null, { headers: noStore, status: 204 });
      } catch (error) {
        return knowledgeErrorResponse(error);
      }
    },
    async resync(_request: Request, rawId: string) {
      try {
        const deps = await getDeps("write");
        await assertWorkspaceUsageAvailable(deps.db, deps.tenantId);
        await resyncKnowledgeSource(deps, knowledgeSourceId.parse(rawId));
        return Response.json({ id: rawId }, { headers: noStore, status: 202 });
      } catch (error) {
        return knowledgeErrorResponse(error);
      }
    },
    async upload(request: Request) {
      try {
        const deps = await getDeps("write");
        await assertWorkspaceUsageAvailable(deps.db, deps.tenantId);
        const length = Number(request.headers.get("content-length"));
        if (length > MAX_KNOWLEDGE_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
          throw new KnowledgeFileError("Knowledge file exceeds 20 MiB");
        }
        const form = await request.formData().catch((cause: unknown) => {
          throw new KnowledgeBadRequestError("Request body must be multipart form data", { cause });
        });
        const file = form.get("file");
        if (!(file instanceof File)) {
          throw new KnowledgeBadRequestError("A file is required");
        }
        const id = await createKnowledgeFileSource(deps, {
          data: new Uint8Array(await file.arrayBuffer()),
          name: file.name,
        });
        return Response.json({ id }, { headers: noStore, status: 201 });
      } catch (error) {
        return knowledgeErrorResponse(error);
      }
    },
  };
}
