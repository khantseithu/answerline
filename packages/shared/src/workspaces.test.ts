import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptWorkspaceInvitationSchema,
  createApiKeySchema,
  createWorkspaceSchema,
  inviteWorkspaceMemberSchema,
  signupWorkspaceInvitationSchema,
  workspaceRoleSchema,
} from "./workspaces.ts";

test("workspace contracts normalize names and invitation email without widening roles", () => {
  assert.deepEqual(createWorkspaceSchema.parse({ name: " Clinic ", slug: "clinic" }), {
    name: "Clinic",
    slug: "clinic",
  });
  assert.deepEqual(
    inviteWorkspaceMemberSchema.parse({ email: " OWNER@EXAMPLE.COM ", role: "admin" }),
    {
      email: "owner@example.com",
      role: "admin",
    }
  );
  assert.equal(createWorkspaceSchema.safeParse({ name: " ", slug: "../other" }).success, false);
  assert.equal(workspaceRoleSchema.safeParse("superadmin").success, false);
});

test("invitation acceptance requires a full random token and signup credentials", () => {
  const token = "a".repeat(43);
  assert.deepEqual(acceptWorkspaceInvitationSchema.parse({ token }), { token });
  assert.equal(acceptWorkspaceInvitationSchema.safeParse({ token: "short" }).success, false);
  assert.equal(signupWorkspaceInvitationSchema.safeParse({ token }).success, false);
  assert.equal(
    signupWorkspaceInvitationSchema.safeParse({ name: "Alex", password: "short", token }).success,
    false
  );
  assert.equal(
    signupWorkspaceInvitationSchema.safeParse({
      name: "Alex",
      password: "long-enough-password",
      token,
    }).success,
    true
  );
});

test("API keys require explicit supported scopes without duplicates", () => {
  assert.deepEqual(
    createApiKeySchema.parse({ name: " Integration ", scopes: ["calls:read", "evals:write"] }),
    {
      name: "Integration",
      scopes: ["calls:read", "evals:write"],
    }
  );
  for (const scopes of [[], ["*"], ["calls:write"], ["calls:read", "calls:read"]]) {
    assert.equal(createApiKeySchema.safeParse({ name: "Integration", scopes }).success, false);
  }
});
