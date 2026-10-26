import { agents, type Database, tenants } from "@answerline/db";
import { languageCodeSchema, type WorkspaceRole } from "@answerline/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AGENT_SLUG_PATTERN, createCallToken, DEFAULT_AGENT_SLUG } from "@/lib/call-token";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";
import { requireWorkspaceAccess } from "@/lib/workspaces/permissions";
import { assertWorkspaceUsageAvailable } from "@/lib/workspaces/usage";

interface CallTokenContext {
  db: Database;
  role: WorkspaceRole;
  tenantId: string;
}

type CallTokenOptions = Omit<
  Parameters<typeof createCallToken>[0],
  "agentSlug" | "language" | "tenantSlug"
>;

export function createCallTokenHandler(
  getContext: () => Promise<CallTokenContext>,
  options: CallTokenOptions
) {
  return async function POST(request: Request) {
    try {
      const { db, role, tenantId } = await getContext();
      requireWorkspaceAccess(role, "write");
      await assertWorkspaceUsageAvailable(db, tenantId);
      const params = new URL(request.url).searchParams;
      const agentSlug = params.get("agent") ?? DEFAULT_AGENT_SLUG;
      if (!AGENT_SLUG_PATTERN.test(agentSlug)) {
        return Response.json({ error: "Invalid agent" }, { status: 400 });
      }
      const language = languageCodeSchema.optional().safeParse(params.get("language") ?? undefined);
      if (!language.success) {
        return Response.json({ error: "Invalid language" }, { status: 400 });
      }

      const [agent] = await db
        .select({ tenantSlug: tenants.slug })
        .from(agents)
        .innerJoin(tenants, eq(tenants.id, agents.tenantId))
        .where(
          and(eq(agents.tenantId, tenantId), eq(agents.slug, agentSlug), isNull(agents.archivedAt))
        );
      if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }

      const details = await createCallToken({
        ...options,
        agentSlug,
        language: language.data,
        tenantSlug: agent.tenantSlug,
      });
      return Response.json(details, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return dashboardErrorResponse(error);
    }
  };
}
