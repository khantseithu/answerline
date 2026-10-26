import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  accounts,
  createDb,
  sessions,
  tenants,
  users,
  workspaceInvitations,
  workspaceMembers,
} from "@answerline/db";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createAgentHandlers } from "@/lib/agents/handlers";
import { createAuth } from "@/lib/auth/config";
import { loginDestination } from "@/lib/auth/redirect";
import {
  DashboardAuthError,
  DashboardForbiddenError,
  WorkspaceRequiredError,
} from "@/lib/dashboard/errors";
import { createEvalHandlers } from "@/lib/evals/handlers";
import { createKnowledgeHandlers } from "@/lib/knowledge/handlers";
import { createPhoneNumberHandlers } from "@/lib/phone-numbers/handlers";
import { createWorkspaceHandlers, workspaceErrorResponse } from "./handlers";
import { requireWorkspaceAccess, type WorkspaceAccess } from "./permissions";
import {
  acceptWorkspaceInvitation,
  createWorkspace,
  getWorkspaceInvitation,
  getWorkspaceSettings,
  inviteWorkspaceMember,
  listWorkspaces,
  removeWorkspaceMember,
  resolveActiveWorkspace,
  revokeWorkspaceInvitation,
  signupWorkspaceInvitation,
  switchWorkspace,
  updateWorkspace,
  updateWorkspaceMember,
  WorkspaceConflictError,
  type WorkspaceDeps,
  WorkspaceNotFoundError,
} from "./service";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const origin = "http://localhost:3092";
const responseSchema = z.object({ id: z.uuid(), url: z.url() });

async function withHarness(
  run: (harness: {
    db: ReturnType<typeof createDb>;
    email: (name: string) => string;
    user: (name: string) => Promise<WorkspaceDeps>;
    workspace: (actor: WorkspaceDeps, name: string) => ReturnType<typeof createWorkspace>;
    handlers: (actor: WorkspaceDeps) => ReturnType<typeof createWorkspaceHandlers>;
  }) => Promise<void>
) {
  const db = createDb();
  const id = crypto.randomUUID();
  const prefix = `workspace-${id}`;
  const email = (name: string) => `${name}-${id}@example.com`;
  try {
    await run({
      db,
      email,
      handlers: (actor) =>
        createWorkspaceHandlers(
          () => Promise.resolve(actor),
          () => ({ db, trustedOrigin: origin })
        ),
      user: async (name) => {
        const [user] = await db
          .insert(users)
          .values({ email: email(name), name })
          .returning();
        assert.ok(user);
        const [session] = await db
          .insert(sessions)
          .values({
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            token: crypto.randomUUID(),
            userId: user.id,
          })
          .returning();
        assert.ok(session);
        return { db, session, user };
      },
      workspace: (actor, name) => createWorkspace(actor, { name, slug: `${prefix}-${name}` }),
    });
  } finally {
    await db.delete(tenants).where(sql`${tenants.slug} like ${`${prefix}%`}`);
    await db.delete(users).where(sql`${users.email} like ${`%${id}@example.com`}`);
    await db.$client.end();
  }
}

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/v1/workspaces`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: requestOrigin },
    method: "POST",
  });
}

function invitationToken(url: string) {
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/invite");
  assert.equal(parsed.search, "");
  const token = parsed.hash.slice(1);
  assert.ok(token);
  return token;
}

test(
  "zero-membership sessions create and switch workspaces without trusting another user's session",
  { skip },
  () =>
    withHarness(async ({ db, user, workspace, handlers }) => {
      const owner = await user("owner");
      assert.deepEqual(await listWorkspaces(owner), []);
      await assert.rejects(resolveActiveWorkspace(owner), WorkspaceRequiredError);
      const first = await workspace(owner, "first");
      assert.equal((await resolveActiveWorkspace(owner)).id, first.id);
      const second = await workspace(owner, "second");
      assert.equal((await resolveActiveWorkspace(owner)).id, second.id);
      const switchResponse = await handlers(owner).switch(request({ workspaceId: first.id }));
      assert.equal(switchResponse.status, 200);
      assert.equal((await resolveActiveWorkspace(owner)).id, first.id);
      const outsider = await user("outsider");
      assert.equal(
        (await handlers(outsider).switch(request({ workspaceId: first.id }))).status,
        403
      );
      await assert.rejects(
        listWorkspaces({ ...outsider, session: owner.session }),
        DashboardAuthError
      );
      await db
        .update(sessions)
        .set({ activeTenantId: first.id })
        .where(eq(sessions.id, outsider.session.id));
      await assert.rejects(resolveActiveWorkspace(outsider), WorkspaceRequiredError);
      await db
        .update(sessions)
        .set({ expiresAt: new Date(0) })
        .where(eq(sessions.id, owner.session.id));
      assert.equal((await handlers(owner).list()).status, 401);
    })
);

test(
  "workspace settings are owner-only and removed members fall back to another workspace",
  { skip },
  () =>
    withHarness(async ({ db, user, workspace, handlers }) => {
      const owner = await user("owner");
      const target = await workspace(owner, "clinic");
      const admin = await user("admin");
      const otherWorkspace = await workspace(admin, "other");
      await db
        .insert(workspaceMembers)
        .values({ role: "admin", tenantId: target.id, userId: admin.user.id });
      await switchWorkspace(admin, { workspaceId: target.id });
      assert.equal((await resolveActiveWorkspace(admin)).role, "admin");
      assert.equal((await handlers(admin).update(request({ name: "No" }), target.id)).status, 403);
      assert.equal(
        (
          await handlers(admin).invite(
            request({ email: "x@example.com", role: "viewer" }),
            target.id
          )
        ).status,
        403
      );
      assert.equal(
        (await handlers(owner).member(request(null), target.id, admin.user.id)).status,
        400
      );
      await updateWorkspace(owner, target.id, { name: "Renamed clinic" });
      assert.equal((await getWorkspaceSettings(owner, target.id)).workspace.name, "Renamed clinic");
      await removeWorkspaceMember(owner, target.id, admin.user.id);
      assert.equal((await resolveActiveWorkspace(admin)).id, otherWorkspace.id);
    })
);

test("owners cannot manage another workspace's settings, members or invitations", { skip }, () =>
  withHarness(async ({ user, workspace, email }) => {
    const first = await user("first-owner");
    const firstWorkspace = await workspace(first, "first");
    const second = await user("second-owner");
    const secondWorkspace = await workspace(second, "second");
    const invitation = await inviteWorkspaceMember(
      second,
      secondWorkspace.id,
      { email: email("invitee"), role: "viewer" },
      origin
    );
    await assert.rejects(
      updateWorkspace(first, secondWorkspace.id, { name: "Wrong workspace" }),
      DashboardForbiddenError
    );
    await assert.rejects(getWorkspaceSettings(first, secondWorkspace.id), DashboardForbiddenError);
    await assert.rejects(
      removeWorkspaceMember(first, secondWorkspace.id, second.user.id),
      DashboardForbiddenError
    );
    await assert.rejects(
      revokeWorkspaceInvitation(first, firstWorkspace.id, invitation.id),
      WorkspaceNotFoundError
    );
    assert.equal((await getWorkspaceSettings(second, secondWorkspace.id)).workspace.name, "second");
    assert.equal((await getWorkspaceSettings(second, secondWorkspace.id)).invitations.length, 1);
  })
);

test("owner changes serialize and cannot remove the final owner", { skip }, () =>
  withHarness(async ({ db, user, workspace }) => {
    const first = await user("first-owner");
    const target = await workspace(first, "clinic");
    const second = await user("second-owner");
    await db
      .insert(workspaceMembers)
      .values({ role: "owner", tenantId: target.id, userId: second.user.id });
    const results = await Promise.allSettled([
      updateWorkspaceMember(first, target.id, first.user.id, { role: "viewer" }),
      updateWorkspaceMember(second, target.id, second.user.id, { role: "viewer" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const owners = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.tenantId, target.id), eq(workspaceMembers.role, "owner")));
    assert.equal(owners.length, 1);
    const remaining = owners[0]?.userId === first.user.id ? first : second;
    await assert.rejects(
      removeWorkspaceMember(remaining, target.id, remaining.user.id),
      WorkspaceConflictError
    );
  })
);

test("a queued membership write rechecks actor ownership after the tenant lock", { skip }, () =>
  withHarness(async ({ db, user, workspace }) => {
    const first = await user("first-owner");
    const target = await workspace(first, "clinic");
    const second = await user("second-owner");
    await db
      .insert(workspaceMembers)
      .values({ role: "owner", tenantId: target.id, userId: second.user.id });
    const results = await Promise.allSettled([
      removeWorkspaceMember(first, target.id, second.user.id),
      removeWorkspaceMember(second, target.id, first.user.id),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result) => result.status === "rejected");
    assert.ok(failure?.status === "rejected" && failure.reason instanceof DashboardForbiddenError);
    const members = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.tenantId, target.id));
    assert.equal(members.length, 1);
    assert.equal(members[0]?.role, "owner");
  })
);

test(
  "invitation links use trusted origin, store hashes, match email and accept only once",
  { skip },
  () =>
    withHarness(async ({ db, user, workspace, handlers, email }) => {
      const owner = await user("owner");
      const target = await workspace(owner, "clinic");
      const invitee = await user("invitee");
      const response = await handlers(owner).invite(
        request({ email: email("invitee").toUpperCase(), role: "viewer" }),
        target.id
      );
      assert.equal(response.status, 201);
      const created = responseSchema.parse(await response.json());
      assert.equal(new URL(created.url).origin, origin);
      const token = invitationToken(created.url);
      const [stored] = await db
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, created.id));
      assert.equal(stored?.tokenHash, createHash("sha256").update(token).digest("hex"));
      assert.notEqual(stored?.tokenHash, token);
      await assert.rejects(
        inviteWorkspaceMember(
          owner,
          target.id,
          { email: email("invitee"), role: "viewer" },
          origin
        ),
        WorkspaceConflictError
      );
      assert.equal((await getWorkspaceInvitation(db, token)).accountExists, true);
      assert.equal((await handlers(owner).accept(request({ token }))).status, 403);
      const results = await Promise.all([
        handlers(invitee).accept(request({ token })),
        handlers(invitee).accept(request({ token })),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 404]);
      assert.equal((await resolveActiveWorkspace(invitee)).id, target.id);
      assert.equal((await resolveActiveWorkspace(invitee)).role, "viewer");
      await assert.rejects(getWorkspaceInvitation(db, token), WorkspaceNotFoundError);
      const settings = await getWorkspaceSettings(owner, target.id);
      assert.deepEqual(settings.invitations, []);
      assert.ok(settings.members.some((member) => member.userId === invitee.user.id));
    })
);

test("workspace DELETE operations require the trusted origin", { skip }, () =>
  withHarness(async ({ db, user, workspace, handlers, email }) => {
    const owner = await user("owner");
    const target = await workspace(owner, "clinic");
    const member = await user("member");
    await db
      .insert(workspaceMembers)
      .values({ role: "viewer", tenantId: target.id, userId: member.user.id });
    const invitation = await inviteWorkspaceMember(
      owner,
      target.id,
      { email: email("invitee"), role: "viewer" },
      origin
    );
    const requestWithOrigin = (path: string, requestOrigin?: string) =>
      new Request(`${origin}${path}`, {
        headers: requestOrigin ? { origin: requestOrigin } : undefined,
        method: "DELETE",
      });
    const api = handlers(owner);
    const memberPath = `/api/v1/workspaces/${target.id}/members/${member.user.id}`;
    const invitationPath = `/api/v1/workspaces/${target.id}/invitations/${invitation.id}`;
    assert.equal(
      (await api.removeMember(requestWithOrigin(memberPath), target.id, member.user.id)).status,
      403
    );
    assert.equal(
      (
        await api.removeMember(
          requestWithOrigin(memberPath, "https://other.example"),
          target.id,
          member.user.id
        )
      ).status,
      403
    );
    assert.equal(
      (await api.revoke(requestWithOrigin(invitationPath), target.id, invitation.id)).status,
      403
    );
    assert.equal(
      (await api.removeMember(requestWithOrigin(memberPath, origin), target.id, member.user.id))
        .status,
      204
    );
    assert.equal(
      (await api.revoke(requestWithOrigin(invitationPath, origin), target.id, invitation.id))
        .status,
      204
    );
  })
);

test("invitation previews require the trusted origin", { skip }, () =>
  withHarness(async ({ user, handlers }) => {
    const owner = await user("owner");
    const previewRequest = (requestOrigin?: string) =>
      new Request(`${origin}/api/invitations/preview`, {
        body: JSON.stringify({ token: "a".repeat(43) }),
        headers: {
          "content-type": "application/json",
          ...(requestOrigin ? { origin: requestOrigin } : {}),
        },
        method: "POST",
      });
    assert.equal((await handlers(owner).preview(previewRequest())).status, 403);
    assert.equal(
      (await handlers(owner).preview(previewRequest("https://other.example"))).status,
      403
    );
    assert.equal((await handlers(owner).preview(previewRequest(origin))).status, 404);
  })
);

test("expired and revoked links cannot create accounts or memberships", { skip }, () =>
  withHarness(async ({ db, user, workspace, email }) => {
    const owner = await user("owner");
    const target = await workspace(owner, "clinic");
    const expired = await inviteWorkspaceMember(
      owner,
      target.id,
      { email: email("expired"), role: "admin" },
      origin
    );
    await db
      .update(workspaceInvitations)
      .set({ createdAt: new Date(0), expiresAt: new Date(1) })
      .where(eq(workspaceInvitations.id, expired.id));
    const revoked = await inviteWorkspaceMember(
      owner,
      target.id,
      { email: email("revoked"), role: "owner" },
      origin
    );
    await revokeWorkspaceInvitation(owner, target.id, revoked.id);
    await Promise.all(
      [expired, revoked].map((link) =>
        assert.rejects(
          signupWorkspaceInvitation(db, {
            name: "New user",
            password: "long-enough-password",
            token: invitationToken(link.url),
          }),
          WorkspaceNotFoundError
        )
      )
    );
    assert.equal(
      (await db.select().from(workspaceMembers).where(eq(workspaceMembers.tenantId, target.id)))
        .length,
      1
    );
    assert.deepEqual(
      await db
        .select()
        .from(users)
        .where(eq(users.email, email("expired"))),
      []
    );
    assert.deepEqual(
      await db
        .select()
        .from(users)
        .where(eq(users.email, email("revoked"))),
      []
    );
  })
);

test(
  "invite-only signup is atomic under concurrency and preserves normal signup prohibition",
  { skip },
  () =>
    withHarness(async ({ db, user, workspace, handlers, email }) => {
      const owner = await user("owner");
      const target = await workspace(owner, "clinic");
      const invitation = await inviteWorkspaceMember(
        owner,
        target.id,
        { email: email("new-user"), role: "admin" },
        origin
      );
      const input = {
        email: email("not-the-invited-address"),
        name: "Invited Operator",
        password: "long-enough-password",
        token: invitationToken(invitation.url),
      };
      assert.equal(
        (await handlers(owner).signup(request(input, "https://evil.example"))).status,
        403
      );
      const results = await Promise.all([
        handlers(owner).signup(request(input)),
        handlers(owner).signup(request(input)),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 404]);
      const [created] = await db
        .select()
        .from(users)
        .where(eq(users.email, email("new-user")));
      assert.ok(created);
      assert.equal(created.emailVerified, false);
      assert.deepEqual(
        await db
          .select()
          .from(users)
          .where(eq(users.email, email("not-the-invited-address"))),
        []
      );
      assert.equal(
        (await db.select().from(accounts).where(eq(accounts.userId, created.id))).length,
        1
      );
      const membership = await db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, created.id));
      assert.equal(membership.length, 1);
      assert.equal(membership[0]?.role, "admin");
      assert.equal(membership[0]?.tenantId, target.id);
      const auth = createAuth(db, { baseURL: origin, secret: crypto.randomUUID() });
      const login = await auth.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          body: JSON.stringify({ email: created.email, password: input.password }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        })
      );
      assert.equal(login.status, 200);
      const registration = await auth.handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          body: JSON.stringify({
            email: email("public-signup"),
            name: "Public",
            password: input.password,
          }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        })
      );
      assert.equal(registration.status, 400);
      assert.deepEqual(
        await db
          .select()
          .from(users)
          .where(eq(users.email, email("public-signup"))),
        []
      );
    })
);

test("invitation signup never overwrites an existing account's credentials", { skip }, () =>
  withHarness(async ({ db, user, workspace, email }) => {
    const owner = await user("owner");
    const target = await workspace(owner, "clinic");
    const existing = await user("existing");
    const password = await hashPassword("original-account-password");
    await db.insert(accounts).values({
      accountId: existing.user.id,
      password,
      providerId: "credential",
      userId: existing.user.id,
    });
    const invitation = await inviteWorkspaceMember(
      owner,
      target.id,
      { email: email("existing"), role: "viewer" },
      origin
    );
    await assert.rejects(
      signupWorkspaceInvitation(db, {
        name: "Imposter",
        password: "replacement-password",
        token: invitationToken(invitation.url),
      }),
      WorkspaceConflictError
    );
    assert.equal(
      (await db.select().from(accounts).where(eq(accounts.userId, existing.user.id)))[0]?.password,
      password
    );
    assert.equal(
      (await db.select().from(users).where(eq(users.id, existing.user.id)))[0]?.name,
      "existing"
    );
    assert.deepEqual(
      await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, existing.user.id)),
      []
    );
    await acceptWorkspaceInvitation(existing, { token: invitationToken(invitation.url) });
    assert.equal((await resolveActiveWorkspace(existing)).id, target.id);
  })
);

test("viewer mutations fail before parsing payloads or resolving live service dependencies", async () => {
  const denied = (access: WorkspaceAccess = "read") => {
    requireWorkspaceAccess("viewer", access);
    throw new Error("Read dependencies should not be needed by a write");
  };
  const agent = createAgentHandlers(denied);
  const knowledge = createKnowledgeHandlers(denied);
  const evals = createEvalHandlers(denied);
  const phone = createPhoneNumberHandlers(denied);
  const id = crypto.randomUUID();
  const results = await Promise.all([
    agent.create(request({})),
    agent.update(request({}), id),
    knowledge.create(request({})),
    knowledge.remove(request({}), id),
    knowledge.resync(request({}), id),
    knowledge.upload(request({})),
    evals.create(request({})),
    phone.create(request({})),
    phone.assign(request({}), "+15555550123"),
    phone.remove(request({}), "+15555550123"),
  ]);
  assert.ok(results.every((response) => response.status === 403));
  assert.doesNotThrow(() => requireWorkspaceAccess("admin", "write"));
  assert.doesNotThrow(() => requireWorkspaceAccess("owner", "write"));
  assert.doesNotThrow(() => requireWorkspaceAccess("viewer", "read"));
});

test("login returns only to the invitation page without carrying invitation tokens", () => {
  assert.equal(loginDestination("/invite"), "/invite");
  for (const target of [
    "https://evil.example",
    "//evil.example",
    `/invite#${"a".repeat(43)}`,
    `/invite/${"a".repeat(43)}`,
    "/api/auth/sign-out",
    undefined,
  ]) {
    assert.equal(loginDestination(target), "/overview");
  }
});

test("workspace HTTP failures never log credential or invitation parameters", async (context) => {
  const secret = "do-not-log-this-invitation-token";
  const logged: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  const response = workspaceErrorResponse(new Error(`Database query failed with ${secret}`));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.equal(JSON.stringify(logged).includes(secret), false);
});
