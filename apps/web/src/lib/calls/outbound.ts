import { randomUUID } from "node:crypto";
import { agents, calls, type Database, tenants } from "@answerline/db";
import {
  callDispatchMetadataSchema,
  outboundCallRequestSchema,
  outboundCallResponseSchema,
} from "@answerline/shared";
import { and, eq, isNull } from "drizzle-orm";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";
import { assertWorkspaceUsageAvailable } from "@/lib/workspaces/usage";

const noStore = { "Cache-Control": "no-store" };

export class OutboundCallError extends Error {
  readonly status: 404 | 502 | 503;

  constructor(message: string, status: 404 | 502 | 503) {
    super(message);
    this.status = status;
  }
}

export interface OutboundCallDeps {
  agentDispatchClient: {
    createDispatch: (
      roomName: string,
      agentName: string,
      options?: { metadata?: string }
    ) => Promise<{ id: string }>;
    deleteDispatch: (dispatchId: string, roomName: string) => Promise<void>;
  };
  agentName: string;
  db: Database;
  livekitTrunkId?: string;
  roomServiceClient: {
    createRoom: (options: { name: string }) => Promise<unknown>;
    deleteRoom: (room: string) => Promise<void>;
  };
  sipClient: {
    createSipParticipant: (
      trunkId: string,
      number: string,
      roomName: string,
      options?: {
        participantAttributes?: Record<string, string>;
        participantIdentity?: string;
        participantName?: string;
      }
    ) => Promise<unknown>;
  };
  tenantId: string;
}

export async function startOutboundCall(deps: OutboundCallDeps, input: unknown) {
  const parsed = outboundCallRequestSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request", issues: parsed.error.issues },
      { headers: noStore, status: 400 }
    );
  }
  if (!deps.livekitTrunkId) {
    return Response.json(
      { error: "Outbound calling is not configured" },
      { headers: noStore, status: 503 }
    );
  }

  try {
    await assertWorkspaceUsageAvailable(deps.db, deps.tenantId);
    const [agent] = await deps.db
      .select({ agentId: agents.id, tenantSlug: tenants.slug })
      .from(agents)
      .innerJoin(tenants, eq(tenants.id, agents.tenantId))
      .where(
        and(
          eq(agents.tenantId, deps.tenantId),
          eq(agents.slug, parsed.data.agent),
          isNull(agents.archivedAt)
        )
      );
    if (!agent) {
      throw new OutboundCallError("Agent not found", 404);
    }

    const callId = randomUUID();
    const roomName = `call-${callId}`;
    const startedAt = new Date();
    await deps.db.insert(calls).values({
      agentId: agent.agentId,
      channel: "sip",
      direction: "outbound",
      id: callId,
      roomName,
      startedAt,
      tenantId: deps.tenantId,
      toNumber: parsed.data.toNumber,
    });

    let roomCreated = false;
    let dispatchId: string | undefined;
    try {
      await deps.roomServiceClient.createRoom({ name: roomName });
      roomCreated = true;
      const dispatch = await deps.agentDispatchClient.createDispatch(roomName, deps.agentName, {
        metadata: JSON.stringify(
          callDispatchMetadataSchema.parse({ agent: parsed.data.agent, tenant: agent.tenantSlug })
        ),
      });
      dispatchId = dispatch.id;
      await deps.sipClient.createSipParticipant(
        deps.livekitTrunkId,
        parsed.data.toNumber,
        roomName,
        {
          participantAttributes: { "answerline.direction": "outbound" },
          participantIdentity: `callee-${callId}`,
          participantName: "Called party",
        }
      );
    } catch (error) {
      const cleanup: Promise<unknown>[] = [
        Promise.resolve(
          deps.db
            .update(calls)
            .set({ endedAt: new Date(), status: "failed" })
            .where(eq(calls.id, callId))
        ),
      ];
      if (dispatchId) {
        cleanup.push(
          Promise.resolve(deps.agentDispatchClient.deleteDispatch(dispatchId, roomName))
        );
      }
      if (roomCreated) {
        cleanup.push(Promise.resolve(deps.roomServiceClient.deleteRoom(roomName)));
      }
      await Promise.allSettled(cleanup);
      console.error(error);
      return Response.json(
        { error: "Unable to start outbound call" },
        { headers: noStore, status: 502 }
      );
    }

    return Response.json(
      outboundCallResponseSchema.parse({ callId, roomName, status: "initiated" }),
      { headers: noStore, status: 202 }
    );
  } catch (error) {
    if (error instanceof OutboundCallError) {
      return Response.json({ error: error.message }, { headers: noStore, status: error.status });
    }
    return dashboardErrorResponse(error);
  }
}

export function createOutboundCallHandlers(getDeps: () => Promise<OutboundCallDeps>) {
  return {
    async create(request: Request) {
      try {
        return await startOutboundCall(await getDeps(), await request.json());
      } catch (error) {
        if (error instanceof SyntaxError) {
          return Response.json(
            { error: "Request body must be JSON" },
            { headers: noStore, status: 400 }
          );
        }
        return dashboardErrorResponse(error);
      }
    },
  };
}
