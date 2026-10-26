import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, calls, createDb, tenants } from "@answerline/db";
import { type OutboundDialJob, parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { DashboardAuthError } from "@/lib/dashboard/errors";
import {
  createOutboundCallHandlers,
  type OutboundCallDeps,
  startOutboundCall,
} from "./outbound.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const requestBody = { agent: "primary", toNumber: "+15551234567" };
const dialEnqueuePattern = /^enqueue:[0-9a-f-]+:3:120000:true$/;

function getDeps(overrides: Partial<OutboundCallDeps> = {}) {
  const events: string[] = [];
  return {
    agentDispatchClient: {
      createDispatch: (roomName: string, agentName: string, options?: { metadata?: string }) => {
        events.push(`dispatch:${roomName}:${agentName}:${options?.metadata}`);
        return Promise.resolve({ id: "dispatch-1" });
      },
      deleteDispatch: (dispatchId: string, roomName: string) => {
        events.push(`delete-dispatch:${dispatchId}:${roomName}`);
        return Promise.resolve();
      },
    },
    agentName: "answerline",
    db: overrides.db ?? createDb(),
    enqueueDial: (job: OutboundDialJob, options: { attempts: number; delayMs: number }) => {
      events.push(
        `enqueue:${job.callId}:${options.attempts}:${options.delayMs}:${job.waitForAgentReady}`
      );
      return Promise.resolve();
    },
    livekitTrunkId: "trunk-1",
    roomServiceClient: {
      createRoom: ({ name }: { name: string }) => {
        events.push(`room:${name}`);
        return Promise.resolve();
      },
      deleteRoom: (roomName: string) => {
        events.push(`delete-room:${roomName}`);
        return Promise.resolve();
      },
    },
    tenantId: crypto.randomUUID(),
    ...overrides,
    events,
  };
}

async function withAgent(
  run: (context: {
    db: ReturnType<typeof createDb>;
    slug: string;
    tenantId: string;
  }) => Promise<void>
) {
  const db = createDb();
  const slug = `outbound-${crypto.randomUUID()}`;
  let tenantId: string | undefined;
  try {
    const [tenant] = await db.insert(tenants).values({ name: slug, slug }).returning();
    assert.ok(tenant);
    tenantId = tenant.id;
    const config = parseAgentConfig(
      `${await readFile(
        new URL("../../../../../agents/bright-smile-dental.yaml", import.meta.url),
        "utf8"
      )}\noutbound:\n  respect_calling_hours: false\n`
    );
    await db.insert(agents).values({ config, name: config.name, slug: "primary", tenantId });
    await run({ db, slug, tenantId });
  } finally {
    if (tenantId) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await db.$client.end();
  }
}

const request = (body: unknown) =>
  new Request("http://localhost/api/v1/calls", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

test("outbound calls require authenticated workspace context", async () => {
  const handlers = createOutboundCallHandlers(() => Promise.reject(new DashboardAuthError()));
  const response = await handlers.create(request(requestBody));
  assert.equal(response.status, 401);
});

test("outbound calls reject outside configured calling hours", { skip }, () =>
  withAgent(async ({ db, tenantId }) => {
    const [agent] = await db.select().from(agents).where(eq(agents.tenantId, tenantId));
    assert.ok(agent?.config.hours);
    assert.ok(agent.config.outbound);
    await db
      .update(agents)
      .set({
        config: {
          ...agent.config,
          hours: { ...agent.config.hours, timezone: "UTC", weekdays: "25:00-25:00" },
          outbound: { ...agent.config.outbound, respect_calling_hours: true },
        },
      })
      .where(eq(agents.id, agent.id));
    const deps = getDeps({ db, tenantId });
    const response = await startOutboundCall(deps, requestBody);
    assert.equal(response.status, 403);
    assert.deepEqual(deps.events, []);
  })
);

test(
  "queues an outbound dial after creating its room and dispatching the workspace agent",
  { skip },
  () =>
    withAgent(async ({ db, slug, tenantId }) => {
      const deps = getDeps({ db, tenantId });
      const response = await startOutboundCall(deps, requestBody);
      assert.equal(response.status, 202);
      const body = (await response.json()) as { callId: string; roomName: string; status: string };
      assert.equal(body.status, "initiated");
      assert.equal(body.roomName, `call-${body.callId}`);
      assert.deepEqual(deps.events, [
        `room:${body.roomName}`,
        `dispatch:${body.roomName}:answerline:${JSON.stringify({ agent: "primary", tenant: slug })}`,
        `enqueue:${body.callId}:1:60000:false`,
      ]);
      const [call] = await db.select().from(calls).where(eq(calls.id, body.callId));
      assert.equal(call?.channel, "sip");
      assert.equal(call?.direction, "outbound");
      assert.equal(call?.toNumber, "+15551234567");
    })
);

test(
  "AMD-enabled outbound calls enqueue a readiness-gated dial with configured retries",
  { skip },
  () =>
    withAgent(async ({ db, tenantId }) => {
      const config = parseAgentConfig(
        `${await readFile(
          new URL("../../../../../agents/bright-smile-dental.yaml", import.meta.url),
          "utf8"
        )}\noutbound:\n  answering_machine_detection: true\n  respect_calling_hours: false\n  retry:\n    max_attempts: 3\n    delay_seconds: 120\n`
      );
      await db.update(agents).set({ config }).where(eq(agents.tenantId, tenantId));
      const deps = getDeps({ db, tenantId });
      const response = await startOutboundCall(deps, requestBody);
      assert.equal(response.status, 202);
      assert.match(
        deps.events.find((event) => event.startsWith("enqueue:")) ?? "",
        dialEnqueuePattern
      );
    })
);

test("marks a failed dial queue submission and removes the room and agent dispatch", { skip }, () =>
  withAgent(async ({ db, tenantId }) => {
    const deps = getDeps({ db, tenantId });
    deps.enqueueDial = () => {
      deps.events.push("queue-failed");
      return Promise.reject(new Error("Dial queue failure"));
    };
    const response = await startOutboundCall(deps, requestBody);
    assert.equal(response.status, 502);
    const room = deps.events.find((event) => event.startsWith("room:"))?.slice("room:".length);
    assert.ok(room);
    assert.deepEqual(deps.events.slice(-3), [
      "queue-failed",
      `delete-dispatch:dispatch-1:${room}`,
      `delete-room:${room}`,
    ]);
    const [call] = await db.select().from(calls).where(eq(calls.roomName, room));
    assert.equal(call?.status, "failed");
  })
);
