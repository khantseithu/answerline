import type { AgentTemplate, AgentVersionView } from "@answerline/shared";
import { agentTemplateSchema, agentVersionViewSchema, agentViewSchema } from "@answerline/shared";

async function request(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return response;
}

const BASE = "/api/v1/agents";
const jsonHeaders = { "Content-Type": "application/json" };

export async function fetchAgents() {
  return agentViewSchema.array().parse(await (await request(BASE)).json());
}

export async function fetchAgentTemplates(): Promise<AgentTemplate[]> {
  return agentTemplateSchema.array().parse(await (await request(`${BASE}/templates`)).json());
}

export async function createAgent(input: { config: AgentTemplate["config"]; slug: string }) {
  return agentViewSchema.parse(
    await (
      await request(BASE, {
        body: JSON.stringify(input),
        headers: jsonHeaders,
        method: "POST",
      })
    ).json()
  );
}

export async function updateAgent(
  id: string,
  input: { config: AgentTemplate["config"]; version: number }
) {
  return agentViewSchema.parse(
    await (
      await request(`${BASE}/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        headers: jsonHeaders,
        method: "PATCH",
      })
    ).json()
  );
}

export async function fetchAgentVersions(id: string): Promise<AgentVersionView[]> {
  return agentVersionViewSchema
    .array()
    .parse(await (await request(`${BASE}/${encodeURIComponent(id)}/versions`)).json());
}
