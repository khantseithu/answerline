import { createHash, randomBytes } from "node:crypto";
import {
  accounts,
  type Database,
  sessions,
  tenants,
  users,
  workspaceInvitations,
  workspaceMembers,
} from "@answerline/db";
import {
  acceptWorkspaceInvitationSchema,
  createWorkspaceSchema,
  invitationTokenSchema,
  inviteWorkspaceMemberSchema,
  signupWorkspaceInvitationSchema,
  switchWorkspaceSchema,
  updateWorkspaceMemberSchema,
  type WorkspaceRole,
  workspaceIdSchema,
} from "@answerline/shared";
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  DashboardAuthError,
  DashboardForbiddenError,
  WorkspaceRequiredError,
} from "@/lib/dashboard/errors";
import { requireWorkspaceOwner } from "./permissions";

export class WorkspaceConflictError extends Error {}
export class WorkspaceNotFoundError extends Error {}
export class WorkspaceBadRequestError extends Error {}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export interface WorkspaceDeps {
  db: Database;
  session: { id: string; userId: string };
  user: Pick<typeof users.$inferSelect, "id" | "email" | "name">;
}

function sessionFilter(deps: WorkspaceDeps) {
  return and(
    eq(sessions.id, deps.session.id),
    eq(sessions.userId, deps.user.id),
    eq(sessions.userId, deps.session.userId),
    gt(sessions.expiresAt, new Date())
  );
}

async function requireSession(tx: Transaction, deps: WorkspaceDeps, lock = false) {
  const query = tx.select().from(sessions).where(sessionFilter(deps));
  const [session] = lock ? await query.for("update") : await query;
  if (!session) {
    throw new DashboardAuthError();
  }
  return session;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  return "cause" in error && isUniqueViolation(error.cause);
}

const workspaceSelection = {
  id: tenants.id,
  name: tenants.name,
  role: workspaceMembers.role,
  slug: tenants.slug,
};

export function listWorkspaces(deps: WorkspaceDeps) {
  return deps.db.transaction(async (tx) => {
    await requireSession(tx, deps);
    return tx
      .select(workspaceSelection)
      .from(workspaceMembers)
      .innerJoin(tenants, eq(tenants.id, workspaceMembers.tenantId))
      .where(eq(workspaceMembers.userId, deps.user.id))
      .orderBy(asc(tenants.name));
  });
}

export function resolveActiveWorkspace(deps: WorkspaceDeps) {
  return deps.db.transaction(async (tx) => {
    const session = await requireSession(tx, deps);
    const [selectedWorkspace] = session.activeTenantId
      ? await tx
          .select(workspaceSelection)
          .from(workspaceMembers)
          .innerJoin(tenants, eq(tenants.id, workspaceMembers.tenantId))
          .where(
            and(eq(workspaceMembers.userId, deps.user.id), eq(tenants.id, session.activeTenantId))
          )
          .limit(1)
      : [];
    const [workspace] = selectedWorkspace
      ? [selectedWorkspace]
      : await tx
          .select(workspaceSelection)
          .from(workspaceMembers)
          .innerJoin(tenants, eq(tenants.id, workspaceMembers.tenantId))
          .where(eq(workspaceMembers.userId, deps.user.id))
          .orderBy(asc(workspaceMembers.createdAt), asc(tenants.name))
          .limit(1);
    if (!workspace) {
      throw new WorkspaceRequiredError("Choose or create a workspace to continue");
    }
    return workspace;
  });
}

export async function createWorkspace(deps: WorkspaceDeps, rawInput: unknown) {
  const input = createWorkspaceSchema.parse(rawInput);
  try {
    return await deps.db.transaction(async (tx) => {
      await requireSession(tx, deps, true);
      const [workspace] = await tx.insert(tenants).values(input).returning();
      if (!workspace) {
        throw new Error("Workspace creation returned no row");
      }
      await tx
        .insert(workspaceMembers)
        .values({ role: "owner", tenantId: workspace.id, userId: deps.user.id });
      await tx.update(sessions).set({ activeTenantId: workspace.id }).where(sessionFilter(deps));
      return {
        id: workspace.id,
        name: workspace.name,
        role: "owner" as const,
        slug: workspace.slug,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WorkspaceConflictError("This workspace slug is already in use", { cause: error });
    }
    throw error;
  }
}

export function switchWorkspace(deps: WorkspaceDeps, rawInput: unknown) {
  const { workspaceId } = switchWorkspaceSchema.parse(rawInput);
  return deps.db.transaction(async (tx) => {
    await requireSession(tx, deps, true);
    const [workspace] = await tx
      .select(workspaceSelection)
      .from(workspaceMembers)
      .innerJoin(tenants, eq(tenants.id, workspaceMembers.tenantId))
      .where(and(eq(workspaceMembers.userId, deps.user.id), eq(tenants.id, workspaceId)));
    if (!workspace) {
      throw new DashboardForbiddenError("You are not a member of this workspace");
    }
    await tx.update(sessions).set({ activeTenantId: workspace.id }).where(sessionFilter(deps));
    return workspace;
  });
}

async function requireOwnerWorkspace(
  tx: Transaction,
  deps: WorkspaceDeps,
  tenantId: string,
  lock = false
) {
  await requireSession(tx, deps, lock);
  const query = tx.select().from(tenants).where(eq(tenants.id, tenantId));
  const [workspace] = lock ? await query.for("update") : await query;
  if (!workspace) {
    throw new WorkspaceNotFoundError("Workspace not found");
  }
  const [member] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, deps.user.id)));
  if (!member) {
    throw new DashboardForbiddenError("You are no longer a member of this workspace");
  }
  requireWorkspaceOwner(member.role);
  return workspace;
}

function lockOwnerWorkspace(tx: Transaction, deps: WorkspaceDeps, tenantId: string) {
  return requireOwnerWorkspace(tx, deps, tenantId, true);
}

export function getWorkspaceSettings(deps: WorkspaceDeps, rawTenantId: string) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  return deps.db.transaction(async (tx) => {
    const workspace = await requireOwnerWorkspace(tx, deps, tenantId);
    const members = await tx
      .select({
        email: users.email,
        name: users.name,
        role: workspaceMembers.role,
        userId: users.id,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.tenantId, tenantId))
      .orderBy(asc(workspaceMembers.createdAt), asc(users.name));
    const invitations = await tx
      .select({
        email: workspaceInvitations.email,
        expiresAt: workspaceInvitations.expiresAt,
        id: workspaceInvitations.id,
        role: workspaceInvitations.role,
      })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.tenantId, tenantId),
          isNull(workspaceInvitations.acceptedAt),
          gt(workspaceInvitations.expiresAt, new Date())
        )
      )
      .orderBy(asc(workspaceInvitations.createdAt));
    return {
      invitations: invitations.map((invite) => ({
        ...invite,
        expiresAt: invite.expiresAt.toISOString(),
      })),
      members,
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    };
  });
}

export function updateWorkspace(deps: WorkspaceDeps, rawTenantId: string, rawInput: unknown) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const input = createWorkspaceSchema.pick({ name: true }).parse(rawInput);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    const [workspace] = await tx
      .update(tenants)
      .set(input)
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, name: tenants.name, slug: tenants.slug });
    return workspace;
  });
}

function mutateWorkspaceMember(
  deps: WorkspaceDeps,
  rawTenantId: string,
  rawUserId: string,
  nextRole: WorkspaceRole | null
) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const userId = workspaceIdSchema.parse(rawUserId);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    const filter = and(
      eq(workspaceMembers.tenantId, tenantId),
      eq(workspaceMembers.userId, userId)
    );
    const [member] = await tx.select().from(workspaceMembers).where(filter);
    if (!member) {
      throw new WorkspaceNotFoundError("Member not found");
    }
    if (member.role === "owner" && nextRole !== "owner") {
      const owners = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.role, "owner")));
      if (owners.length <= 1) {
        throw new WorkspaceConflictError("A workspace must keep at least one owner");
      }
    }
    if (nextRole) {
      await tx.update(workspaceMembers).set({ role: nextRole }).where(filter);
    } else {
      await tx.delete(workspaceMembers).where(filter);
    }
  });
}

export function updateWorkspaceMember(
  deps: WorkspaceDeps,
  tenantId: string,
  userId: string,
  rawInput: unknown
) {
  const { role } = updateWorkspaceMemberSchema.parse(rawInput);
  return mutateWorkspaceMember(deps, tenantId, userId, role);
}

export function removeWorkspaceMember(deps: WorkspaceDeps, tenantId: string, userId: string) {
  return mutateWorkspaceMember(deps, tenantId, userId, null);
}

function tokenHash(rawToken: string) {
  return createHash("sha256").update(invitationTokenSchema.parse(rawToken)).digest("hex");
}

export function inviteWorkspaceMember(
  deps: WorkspaceDeps,
  rawTenantId: string,
  rawInput: unknown,
  trustedOrigin: string
) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const input = inviteWorkspaceMemberSchema.parse(rawInput);
  const token = randomBytes(32).toString("base64url");
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    const [existing] = await tx
      .select({ id: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.tenantId, tenantId), sql`lower(${users.email}) = ${input.email}`)
      );
    if (existing) {
      throw new WorkspaceConflictError("This person is already a workspace member");
    }
    const [pendingInvitation] = await tx
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.tenantId, tenantId),
          eq(workspaceInvitations.email, input.email),
          isNull(workspaceInvitations.acceptedAt),
          gt(workspaceInvitations.expiresAt, new Date())
        )
      );
    if (pendingInvitation) {
      throw new WorkspaceConflictError("An invitation is already pending for this email");
    }
    const [invite] = await tx
      .insert(workspaceInvitations)
      .values({
        ...input,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedBy: deps.user.id,
        tenantId,
        tokenHash: tokenHash(token),
      })
      .returning({ id: workspaceInvitations.id });
    if (!invite) {
      throw new Error("Invitation creation returned no row");
    }
    const url = new URL("/invite", trustedOrigin);
    url.hash = token;
    return { id: invite.id, url: url.toString() };
  });
}

export function revokeWorkspaceInvitation(
  deps: WorkspaceDeps,
  rawTenantId: string,
  rawInviteId: string
) {
  const tenantId = workspaceIdSchema.parse(rawTenantId);
  const id = workspaceIdSchema.parse(rawInviteId);
  return deps.db.transaction(async (tx) => {
    await lockOwnerWorkspace(tx, deps, tenantId);
    const [invite] = await tx
      .delete(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.id, id),
          eq(workspaceInvitations.tenantId, tenantId),
          isNull(workspaceInvitations.acceptedAt)
        )
      )
      .returning({ id: workspaceInvitations.id });
    if (!invite) {
      throw new WorkspaceNotFoundError("Invitation not found");
    }
  });
}

export async function getWorkspaceInvitation(db: Database, rawToken: string) {
  const hash = tokenHash(rawToken);
  const [invite] = await db
    .select({
      email: workspaceInvitations.email,
      expiresAt: workspaceInvitations.expiresAt,
      role: workspaceInvitations.role,
      workspaceName: tenants.name,
    })
    .from(workspaceInvitations)
    .innerJoin(tenants, eq(tenants.id, workspaceInvitations.tenantId))
    .where(
      and(
        eq(workspaceInvitations.tokenHash, hash),
        isNull(workspaceInvitations.acceptedAt),
        gt(workspaceInvitations.expiresAt, new Date())
      )
    );
  if (!invite) {
    throw new WorkspaceNotFoundError(
      "This invitation has expired, was revoked, or has already been used"
    );
  }
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${invite.email}`);
  return { ...invite, accountExists: Boolean(existing), expiresAt: invite.expiresAt.toISOString() };
}

async function lockInvitation(tx: Transaction, hash: string) {
  const [reference] = await tx
    .select({ tenantId: workspaceInvitations.tenantId })
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.tokenHash, hash));
  if (!reference) {
    throw new WorkspaceNotFoundError(
      "This invitation has expired, was revoked, or has already been used"
    );
  }
  await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, reference.tenantId))
    .for("update");
  const [invite] = await tx
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.tokenHash, hash))
    .for("update");
  if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
    throw new WorkspaceNotFoundError(
      "This invitation has expired, was revoked, or has already been used"
    );
  }
  return invite;
}

export function acceptWorkspaceInvitation(deps: WorkspaceDeps, rawInput: unknown) {
  const { token } = acceptWorkspaceInvitationSchema.parse(rawInput);
  return deps.db.transaction(async (tx) => {
    await requireSession(tx, deps, true);
    const invite = await lockInvitation(tx, tokenHash(token));
    if (deps.user.email.toLowerCase() !== invite.email) {
      throw new DashboardForbiddenError(
        "Sign in with the email address this invitation was sent to"
      );
    }
    const [existing] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.tenantId, invite.tenantId),
          eq(workspaceMembers.userId, deps.user.id)
        )
      );
    if (existing) {
      throw new WorkspaceConflictError("You are already a member of this workspace");
    }
    await tx
      .insert(workspaceMembers)
      .values({ role: invite.role, tenantId: invite.tenantId, userId: deps.user.id });
    await tx
      .update(workspaceInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(workspaceInvitations.id, invite.id));
    await tx.update(sessions).set({ activeTenantId: invite.tenantId }).where(sessionFilter(deps));
    return { workspaceId: invite.tenantId };
  });
}

export async function signupWorkspaceInvitation(db: Database, rawInput: unknown) {
  const input = signupWorkspaceInvitationSchema.parse(rawInput);
  const hash = tokenHash(input.token);
  await getWorkspaceInvitation(db, input.token);
  const password = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const invite = await lockInvitation(tx, hash);
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${invite.email}`);
      if (existing) {
        throw new WorkspaceConflictError(
          "An account already exists for this email. Sign in to accept the invitation."
        );
      }
      const [user] = await tx
        .insert(users)
        .values({ email: invite.email, emailVerified: false, name: input.name })
        .returning();
      if (!user) {
        throw new Error("Invitation signup returned no user");
      }
      await tx
        .insert(accounts)
        .values({ accountId: user.id, password, providerId: "credential", userId: user.id });
      await tx
        .insert(workspaceMembers)
        .values({ role: invite.role, tenantId: invite.tenantId, userId: user.id });
      await tx
        .update(workspaceInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(workspaceInvitations.id, invite.id));
      return { email: user.email, workspaceId: invite.tenantId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WorkspaceConflictError(
        "An account or membership already exists. Sign in to continue.",
        { cause: error }
      );
    }
    throw error;
  }
}
