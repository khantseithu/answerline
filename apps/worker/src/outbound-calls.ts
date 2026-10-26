import { agents, calls, type Database, tenants } from "@answerline/db";
import { isWithinCallingHours, outboundDialJobSchema } from "@answerline/shared";
import { UnrecoverableError } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

const readyMetadataSchema = z.object({
  answerline: z.object({ outbound_ready: z.literal(true) }).optional(),
});

export function hasOutboundReadyMetadata(raw: string) {
  try {
    const parsed = readyMetadataSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.answerline?.outbound_ready === true;
  } catch {
    return false;
  }
}

export interface OutboundDialDeps {
  db: Database;
  livekit?: {
    roomServiceClient: {
      deleteRoom: (roomName: string) => Promise<unknown>;
      listParticipants: (roomName: string) => Promise<{ identity: string }[]>;
      listRooms: (names: string[]) => Promise<{ metadata?: string }[]>;
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
          ringingTimeout?: number;
          timeout?: number;
          waitUntilAnswered?: boolean;
        }
      ) => Promise<unknown>;
    };
    trunkId: string;
  };
}

interface OutboundDialAttempt {
  attemptsMade: number;
  data: unknown;
  opts: { attempts?: number };
}

interface RoomMetadataReader {
  listRooms: (names: string[]) => Promise<{ metadata?: string }[]>;
}

export function waitForOutboundAgent(roomServiceClient: RoomMetadataReader, roomName: string) {
  const timeoutAt = Date.now() + 30_000;
  return new Promise<void>((resolve, reject) => {
    const poll = () => {
      roomServiceClient
        .listRooms([roomName])
        .then(([room]) => {
          if (room?.metadata && hasOutboundReadyMetadata(room.metadata)) {
            resolve();
          } else if (Date.now() >= timeoutAt) {
            reject(new Error("Outbound agent did not initialize AMD before dialing"));
          } else {
            setTimeout(poll, 250);
          }
        })
        .catch(reject);
    };
    poll();
  });
}

export function createOutboundDialProcessor({ db, livekit }: OutboundDialDeps) {
  return async (job: OutboundDialAttempt) => {
    const data = outboundDialJobSchema.parse(job.data);
    const [call] = await db
      .select({ config: agents.config, status: calls.status })
      .from(calls)
      .innerJoin(agents, eq(agents.id, calls.agentId))
      .innerJoin(tenants, eq(tenants.id, calls.tenantId))
      .where(
        and(
          eq(calls.id, data.callId),
          eq(calls.roomName, data.roomName),
          eq(calls.direction, "outbound"),
          eq(calls.toNumber, data.toNumber),
          eq(agents.slug, data.agent),
          eq(tenants.slug, data.tenant),
          isNull(agents.archivedAt)
        )
      );
    if (!call) {
      throw new UnrecoverableError("Outbound dial job does not match a workspace call");
    }
    if (call.status !== "in_progress") {
      return;
    }
    try {
      if (!livekit) {
        throw new Error("Outbound SIP is not configured on the worker");
      }
      if (
        call.config.outbound?.respect_calling_hours !== false &&
        call.config.hours &&
        !isWithinCallingHours(call.config.hours)
      ) {
        throw new UnrecoverableError("Workspace calling hours do not permit this outbound dial");
      }
      if (data.waitForAgentReady) {
        await waitForOutboundAgent(livekit.roomServiceClient, data.roomName);
      }
      const identity = `callee-${data.callId}`;
      const participants = await livekit.roomServiceClient.listParticipants(data.roomName);
      if (participants.some((participant) => participant.identity === identity)) {
        return;
      }
      await livekit.sipClient.createSipParticipant(livekit.trunkId, data.toNumber, data.roomName, {
        participantAttributes: { "answerline.direction": "outbound" },
        participantIdentity: identity,
        participantName: "Called party",
        ringingTimeout: 60,
        timeout: 90,
        waitUntilAnswered: true,
      });
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      if (error instanceof UnrecoverableError || job.attemptsMade + 1 >= attempts) {
        await Promise.allSettled([
          db
            .update(calls)
            .set({ endedAt: new Date(), status: "failed" })
            .where(eq(calls.id, data.callId)),
          livekit?.roomServiceClient.deleteRoom(data.roomName),
        ]);
      }
      throw error;
    }
  };
}
