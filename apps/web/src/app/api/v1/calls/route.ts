import { AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import { connection } from "next/server";
import { env } from "@/env";
import { getWorkspaceApiContext } from "@/lib/api-keys/context";
import { createOutboundCallHandlers } from "@/lib/calls/outbound";
import { parseCallsQuery } from "@/lib/calls/query";
import { listCalls } from "@/lib/calls/service";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

const noStore = { "Cache-Control": "no-store" };
const livekitHost = env.LIVEKIT_URL.replace(/^ws/, "http");
const roomServiceClient = new RoomServiceClient(
  livekitHost,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET
);
const agentDispatchClient = new AgentDispatchClient(
  livekitHost,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET
);
const sipClient = new SipClient(livekitHost, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

const outboundCallHandlers = createOutboundCallHandlers(async () => {
  const context = await getWorkspaceApiContext("calls:write", "write");
  return {
    agentDispatchClient,
    agentName: env.AGENT_NAME,
    db: context.db,
    livekitTrunkId: env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID,
    roomServiceClient,
    sipClient,
    tenantId: context.tenantId,
  };
});

export async function GET(request: Request) {
  await connection();
  const parsed = parseCallsQuery(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query", issues: parsed.error.issues },
      { headers: noStore, status: 400 }
    );
  }
  try {
    const { db, tenantId } = await getWorkspaceApiContext("calls:read", "read");
    return Response.json(await listCalls(db, tenantId, parsed.data), { headers: noStore });
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}

export async function POST(request: Request) {
  await connection();
  return outboundCallHandlers.create(request);
}
