import { z } from "zod";

export const workspaceIdSchema = z.uuid();
export const workspaceSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
export const workspaceRoleSchema = z.enum(["owner", "admin", "viewer"]);
export const apiKeyScopeSchema = z.enum([
  "calls:read",
  "agents:read",
  "agents:write",
  "knowledge:read",
  "knowledge:write",
  "evals:read",
  "evals:write",
]);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: workspaceSlugSchema,
});
export const switchWorkspaceSchema = z.object({ workspaceId: workspaceIdSchema });
export const inviteWorkspaceMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: workspaceRoleSchema,
});
export const updateWorkspaceMemberSchema = z.object({ role: workspaceRoleSchema });
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const acceptWorkspaceInvitationSchema = z.object({ token: invitationTokenSchema });
export const signupWorkspaceInvitationSchema = acceptWorkspaceInvitationSchema.extend({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(128),
});
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(apiKeyScopeSchema)
    .min(1)
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: "Scopes must be unique",
    }),
});

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;
export type CreateWorkspace = z.infer<typeof createWorkspaceSchema>;
export type InviteWorkspaceMember = z.infer<typeof inviteWorkspaceMemberSchema>;
export type AcceptWorkspaceInvitation = z.infer<typeof acceptWorkspaceInvitationSchema>;
export type SignupWorkspaceInvitation = z.infer<typeof signupWorkspaceInvitationSchema>;
export type CreateApiKey = z.infer<typeof createApiKeySchema>;
