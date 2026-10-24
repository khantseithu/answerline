import { agents, agentVersions, type Database } from "@answerline/db";
import {
  type AgentVersionView,
  type AgentView,
  agentIdSchema,
  agentVersionViewSchema,
  agentViewSchema,
  type CreateAgent,
  createAgentSchema,
  type UpdateAgent,
  updateAgentSchema,
} from "@answerline/shared";
import { and, asc, desc, eq } from "drizzle-orm";

export class AgentNotFoundError extends Error {}
export class AgentConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
export class AgentBadRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export interface AgentDeps {
  db: Database;
  tenantId: string;
}

function agentView(row: typeof agents.$inferSelect): AgentView {
  return agentViewSchema.parse({
    config: row.config,
    id: row.id,
    name: row.name,
    slug: row.slug,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  });
}

export async function listAgents(deps: AgentDeps): Promise<AgentView[]> {
  const rows = await deps.db
    .select()
    .from(agents)
    .where(eq(agents.tenantId, deps.tenantId))
    .orderBy(asc(agents.name));
  return rows.map(agentView);
}

export async function getAgent(deps: AgentDeps, rawId: string): Promise<AgentView> {
  const id = agentIdSchema.parse(rawId);
  const [row] = await deps.db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, deps.tenantId)))
    .limit(1);
  if (!row) {
    throw new AgentNotFoundError("Agent not found");
  }
  return agentView(row);
}

export async function listAgentVersions(
  deps: AgentDeps,
  rawId: string
): Promise<AgentVersionView[]> {
  const id = agentIdSchema.parse(rawId);
  const [agent] = await deps.db
    .select({
      config: agents.config,
      createdAt: agents.createdAt,
      id: agents.id,
      updatedAt: agents.updatedAt,
      version: agents.version,
    })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, deps.tenantId)))
    .limit(1);
  if (!agent) {
    throw new AgentNotFoundError("Agent not found");
  }
  const rows = await deps.db
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.agentId, id))
    .orderBy(desc(agentVersions.version));
  const history = rows.map((row) =>
    agentVersionViewSchema.parse({
      config: row.config,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    })
  );
  if (history.some((version) => version.version === agent.version)) {
    return history;
  }
  return [
    agentVersionViewSchema.parse({
      config: agent.config,
      createdAt: (agent.version === 1 ? agent.createdAt : agent.updatedAt).toISOString(),
      version: agent.version,
    }),
    ...history,
  ];
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  return "cause" in error && isUniqueViolation(error.cause);
}

export async function createAgent(deps: AgentDeps, rawInput: unknown): Promise<AgentView> {
  const input = createAgentSchema.parse(rawInput) satisfies CreateAgent;
  try {
    return await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(agents)
        .values({
          config: input.config,
          name: input.config.name,
          slug: input.slug,
          tenantId: deps.tenantId,
        })
        .returning();
      if (!row) {
        throw new Error("Agent creation returned no row");
      }
      await tx.insert(agentVersions).values({
        agentId: row.id,
        config: row.config,
        version: row.version,
      });
      return agentView(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AgentConflictError("An agent with this slug already exists", { cause: error });
    }
    throw error;
  }
}

export function updateAgent(deps: AgentDeps, rawId: string, rawInput: unknown): Promise<AgentView> {
  const id = agentIdSchema.parse(rawId);
  const input = updateAgentSchema.parse(rawInput) satisfies UpdateAgent;
  return deps.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenantId, deps.tenantId)))
      .limit(1);
    if (!current) {
      throw new AgentNotFoundError("Agent not found");
    }
    const [updated] = await tx
      .update(agents)
      .set({
        config: input.config,
        name: input.config.name,
        updatedAt: new Date(),
        version: input.version + 1,
      })
      .where(
        and(
          eq(agents.id, id),
          eq(agents.tenantId, deps.tenantId),
          eq(agents.version, input.version)
        )
      )
      .returning();
    if (!updated) {
      throw new AgentConflictError("This agent changed since you opened it. Reload and try again.");
    }
    const [baseline] = await tx
      .select({ version: agentVersions.version })
      .from(agentVersions)
      .where(and(eq(agentVersions.agentId, id), eq(agentVersions.version, current.version)))
      .limit(1);
    if (!baseline) {
      await tx.insert(agentVersions).values({
        agentId: id,
        config: current.config,
        version: current.version,
      });
    }
    await tx.insert(agentVersions).values({
      agentId: id,
      config: updated.config,
      version: updated.version,
    });
    return agentView(updated);
  });
}
