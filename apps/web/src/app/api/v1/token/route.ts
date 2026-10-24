import { agents } from "@answerline/db";
import { and, eq } from "drizzle-orm";
import { env } from "@/env";
import { AGENT_SLUG_PATTERN, createCallToken, DEFAULT_AGENT_SLUG } from "@/lib/call-token";
import { getDashboardContext } from "@/lib/dashboard/context";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

export async function POST(request: Request) {
  try {
    const { db, tenantId } = await getDashboardContext();
    const agentSlug = new URL(request.url).searchParams.get("agent") ?? DEFAULT_AGENT_SLUG;
    if (!AGENT_SLUG_PATTERN.test(agentSlug)) {
      return Response.json({ error: "Invalid agent" }, { status: 400 });
    }

    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.slug, agentSlug)));
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }
    const details = await createCallToken({
      agentName: env.AGENT_NAME,
      agentSlug,
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      serverUrl: env.LIVEKIT_URL,
    });

    return Response.json(details, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}
