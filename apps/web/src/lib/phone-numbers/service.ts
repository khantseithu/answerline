import {
  addPhoneNumber,
  assignPhoneNumber,
  listPhoneNumbers,
  type PhoneNumberClient,
  type PhoneNumberScope,
  removePhoneNumber,
} from "@answerline/worker/phone-numbers";
import { z } from "zod";
import type { AgentOption, PhoneNumberList } from "./types";

export class PhoneNumberConflictError extends Error {}
export class PhoneNumberNotFoundError extends Error {}
export class PhoneNumberBadRequestError extends Error {}
export class PhoneNumberUnavailableError extends Error {}

export interface PhoneNumberDeps extends PhoneNumberScope {
  agentName: string;
  client: PhoneNumberClient;
  listAgents: () => Promise<AgentOption[]>;
}

const CONFLICT = /already connected|shares a LiveKit/;
const NOT_FOUND = /not connected/;

async function livekit<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error;
    }
    if (error instanceof Error && CONFLICT.test(error.message)) {
      throw new PhoneNumberConflictError(error.message, { cause: error });
    }
    if (error instanceof Error && NOT_FOUND.test(error.message)) {
      throw new PhoneNumberNotFoundError(error.message, { cause: error });
    }
    throw new PhoneNumberUnavailableError(
      "Could not reach the SIP service. Check that LiveKit and the SIP service are running.",
      { cause: error }
    );
  }
}

async function requireAgent(deps: PhoneNumberDeps, slug: string) {
  const agents = await deps.listAgents();
  if (!agents.some((agent) => agent.slug === slug)) {
    throw new PhoneNumberBadRequestError(`Agent "${slug}" does not exist`);
  }
}

export async function listPhoneNumberView(deps: PhoneNumberDeps): Promise<PhoneNumberList> {
  const [agents, numbers] = await Promise.all([
    deps.listAgents(),
    livekit(() => listPhoneNumbers(deps.client, deps)),
  ]);
  return { agents, numbers: numbers.map(({ agent, number }) => ({ agent, number })) };
}

export async function connectPhoneNumber(
  deps: PhoneNumberDeps,
  input: { agent: string; number: string }
) {
  await requireAgent(deps, input.agent);
  const { agent, number } = await livekit(() =>
    addPhoneNumber(deps.client, deps, deps.agentName, input)
  );
  return { agent, number };
}

export async function reassignPhoneNumber(deps: PhoneNumberDeps, number: string, agent: string) {
  await requireAgent(deps, agent);
  const result = await livekit(() =>
    assignPhoneNumber(deps.client, deps, deps.agentName, number, agent)
  );
  return { agent: result.agent, number: result.number };
}

export async function disconnectPhoneNumber(deps: PhoneNumberDeps, number: string) {
  await livekit(() => removePhoneNumber(deps.client, deps, number));
}
