import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { agents, agentVersions, calls, createDb, knowledgeSources, tenants } from "@answerline/db";
import { agentTemplateSchema, createAgentSchema, parseAgentConfig } from "@answerline/shared";
import { eq } from "drizzle-orm";
import { DashboardAuthError } from "@/lib/dashboard/errors";
import { createAgentHandlers } from "./handlers.ts";
import type { AgentDeps } from "./service.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

async function baselineConfig() {
  return parseAgentConfig(
    await readFile(
      new URL("../../../../../agents/bright-smile-dental.yaml", import.meta.url),
      "utf8"
    )
  );
}

async function withHarness(
  run: (context: {
    config: Awaited<ReturnType<typeof baselineConfig>>;
    deps: AgentDeps;
    foreignDeps: AgentDeps;
    handlers: ReturnType<typeof createAgentHandlers>;
  }) => Promise<void>
) {
  const db = createDb();
  const tenantId = crypto.randomUUID();
  const foreignTenantId = crypto.randomUUID();
  const slug = `agent-test-${tenantId}`;
  try {
    await db.insert(tenants).values([
      { id: tenantId, name: slug, slug },
      { id: foreignTenantId, name: `foreign-${slug}`, slug: `foreign-${slug}` },
    ]);
    const deps = { db, tenantId };
    const foreignDeps = { db, tenantId: foreignTenantId };
    await run({
      config: await baselineConfig(),
      deps,
      foreignDeps,
      handlers: createAgentHandlers(() => Promise.resolve(deps)),
    });
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, foreignTenantId));
    await db.$client.end();
  }
}

const request = (body: unknown) =>
  new Request("http://localhost/api/v1/agents", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

async function responseBody<T>(response: Response) {
  return (await response.json()) as T;
}

test("lists the 30 valid template configs for an authorized workspace", { skip }, () =>
  withHarness(async ({ handlers }) => {
    const response = await handlers.templates();
    assert.equal(response.status, 200);
    const templates = agentTemplateSchema.array().parse(await response.json());
    assert.equal(templates.length, 30);
    assert.ok(templates.every((template) => template.config.instructions.length > 0));
  })
);

test("agent templates require workspace authentication", async () => {
  let checked = false;
  const handlers = createAgentHandlers(() => {
    checked = true;
    return Promise.reject(new DashboardAuthError());
  });
  assert.equal((await handlers.templates()).status, 401);
  assert.ok(checked);
});

test(
  "creates snapshots, scopes reads, and preserves a baseline when first editing legacy agents",
  { skip },
  () =>
    withHarness(async ({ config, deps, foreignDeps, handlers }) => {
      const create = await handlers.create(request({ config, slug: "front-desk" }));
      assert.equal(create.status, 201);
      const created = await responseBody<{ id: string; version: number }>(create);
      assert.equal(created.version, 1);
      const createdHistory = await handlers.versions(created.id);
      assert.deepEqual(
        (await responseBody<{ version: number }[]>(createdHistory)).map(({ version }) => version),
        [1]
      );
      assert.equal((await handlers.create(request({ config, slug: "front-desk" }))).status, 409);

      const [legacy] = await deps.db
        .insert(agents)
        .values({ config, name: config.name, slug: "legacy", tenantId: deps.tenantId })
        .returning();
      assert.ok(legacy);
      const legacyBeforeUpdate = await handlers.versions(legacy.id);
      assert.deepEqual(
        (
          await responseBody<{ config: { greeting: string }; version: number }[]>(
            legacyBeforeUpdate
          )
        ).map(({ config: snapshot, version }) => [version, snapshot.greeting]),
        [[1, config.greeting]]
      );
      const updatedConfig = { ...config, greeting: "Thanks for calling" };
      const update = await handlers.update(
        request({ config: updatedConfig, version: legacy.version }),
        legacy.id
      );
      assert.equal(update.status, 200);
      const updated = await responseBody<{ version: number }>(update);
      assert.equal(updated.version, 2);
      const legacyHistory = await handlers.versions(legacy.id);
      assert.deepEqual(
        (
          await responseBody<{ config: { greeting: string }; version: number }[]>(legacyHistory)
        ).map(({ config: snapshot, version }) => [version, snapshot.greeting]),
        [
          [2, "Thanks for calling"],
          [1, config.greeting],
        ]
      );

      const [foreign] = await deps.db
        .insert(agents)
        .values({
          config,
          name: config.name,
          slug: "foreign-agent",
          tenantId: foreignDeps.tenantId,
        })
        .returning();
      assert.ok(foreign);
      const foreignRequests: Response[] = await Promise.all([
        handlers.detail(foreign.id),
        handlers.versions(foreign.id),
        handlers.update(request({ config: updatedConfig, version: 1 }), foreign.id),
        handlers.detail(MISSING_ID),
      ]);
      assert.deepEqual(
        foreignRequests.map((response) => response.status),
        [404, 404, 404, 404]
      );
      const listed = await responseBody<{ id: string }[]>(await handlers.list());
      assert.ok(listed.some(({ id }) => id === created.id));
      assert.ok(!listed.some(({ id }) => id === foreign.id));
      assert.deepEqual(createAgentSchema.parse({ config, slug: "valid-slug" }).slug, "valid-slug");
    })
);

test("only one concurrent optimistic update commits and records history", { skip }, () =>
  withHarness(async ({ config, deps, handlers }) => {
    const [agent] = await deps.db
      .insert(agents)
      .values({ config, name: config.name, slug: "concurrent", tenantId: deps.tenantId })
      .returning();
    assert.ok(agent);
    const updates: Response[] = await Promise.all([
      handlers.update(
        request({ config: { ...config, greeting: "Update one" }, version: 1 }),
        agent.id
      ),
      handlers.update(
        request({ config: { ...config, greeting: "Update two" }, version: 1 }),
        agent.id
      ),
    ]);
    assert.deepEqual(updates.map((response) => response.status).sort(), [200, 409]);
    const history = await deps.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agent.id));
    assert.deepEqual(history.map(({ version }) => version).sort(), [1, 2]);
  })
);

test("archives agents without deleting call or knowledge history", { skip }, () =>
  withHarness(async ({ config, deps, handlers }) => {
    const [agent] = await deps.db
      .insert(agents)
      .values({ config, name: config.name, slug: "archived", tenantId: deps.tenantId })
      .returning();
    assert.ok(agent);
    const [call] = await deps.db
      .insert(calls)
      .values({
        agentId: agent.id,
        channel: "web",
        roomName: crypto.randomUUID(),
        tenantId: deps.tenantId,
      })
      .returning();
    const [source] = await deps.db
      .insert(knowledgeSources)
      .values({ agentId: agent.id, tenantId: deps.tenantId, title: "FAQ", type: "text" })
      .returning();
    assert.ok(call);
    assert.ok(source);

    const response = await handlers.delete(agent.id);
    assert.equal(response.status, 204);
    assert.equal((await handlers.delete(agent.id)).status, 404);
    assert.equal((await handlers.detail(agent.id)).status, 404);
    assert.equal((await handlers.versions(agent.id)).status, 404);
    assert.equal((await handlers.update(request({ config, version: 1 }), agent.id)).status, 404);
    assert.ok(
      !(await responseBody<{ id: string }[]>(await handlers.list())).some(
        ({ id }) => id === agent.id
      )
    );

    const [archived] = await deps.db.select().from(agents).where(eq(agents.id, agent.id));
    const [preservedCall] = await deps.db.select().from(calls).where(eq(calls.id, call.id));
    const [preservedSource] = await deps.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, source.id));
    assert.ok(archived?.archivedAt);
    assert.equal(preservedCall?.id, call.id);
    assert.equal(preservedSource?.id, source.id);
  })
);
