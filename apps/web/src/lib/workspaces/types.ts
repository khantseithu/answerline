import type { getWorkspaceInvitation, getWorkspaceSettings, listWorkspaces } from "./service";

export type WorkspaceView = Awaited<ReturnType<typeof listWorkspaces>>[number];
export type WorkspaceSettings = Awaited<ReturnType<typeof getWorkspaceSettings>>;
export type WorkspaceInvitationView = Awaited<ReturnType<typeof getWorkspaceInvitation>>;
