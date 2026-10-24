import {
  RoomAgentDispatch,
  RoomConfiguration,
  type SIPDispatchRuleInfo,
  SipClient,
} from "livekit-server-sdk";
import { z } from "zod";

export type PhoneNumberClient = Pick<
  SipClient,
  | "createSipDispatchRule"
  | "createSipInboundTrunk"
  | "deleteSipDispatchRule"
  | "deleteSipTrunk"
  | "listSipDispatchRule"
  | "listSipInboundTrunk"
  | "updateSipDispatchRule"
>;

export interface PhoneNumber {
  agent: string | null;
  dispatchRuleId: string | null;
  number: string;
  trunkId: string;
}

export const ROOM_PREFIX = "call-";
const WS_SCHEME = /^ws/;

export const phoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "expected an E.164 number like +15551234567");
export const agentSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "invalid agent slug");

export const addPhoneNumberInput = z.object({
  agent: agentSlugSchema,
  allowedAddresses: z.array(z.string().min(1)).optional(),
  authPassword: z.string().min(1).optional(),
  authUsername: z.string().min(1).optional(),
  number: phoneNumberSchema,
});
export type AddPhoneNumberInput = z.infer<typeof addPhoneNumberInput>;

export const sipEnvSchema = z.object({
  AGENT_NAME: z.string().min(1).default("answerline"),
  LIVEKIT_API_KEY: z.string().min(1).default("devkey"),
  LIVEKIT_API_SECRET: z.string().min(1).default("secret"),
  LIVEKIT_URL: z.url().default("ws://localhost:7880"),
});

export function createPhoneNumberClient(env: z.infer<typeof sipEnvSchema>): PhoneNumberClient {
  const url = env.LIVEKIT_URL.replace(WS_SCHEME, "http");
  return new SipClient(url, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

const ruleName = (number: string) => `answerline ${number}`;

function roomConfig(agentName: string, agent: string) {
  return new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName, metadata: JSON.stringify({ agent }) })],
  });
}

const dispatchMetadata = z.object({ agent: agentSlugSchema });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function ruleAgent(rule: SIPDispatchRuleInfo): string | null {
  for (const dispatch of rule.roomConfig?.agents ?? []) {
    const parsed = dispatchMetadata.safeParse(parseJson(dispatch.metadata));
    if (parsed.success) {
      return parsed.data.agent;
    }
  }
  return null;
}

export async function listPhoneNumbers(client: PhoneNumberClient): Promise<PhoneNumber[]> {
  const [trunks, rules] = await Promise.all([
    client.listSipInboundTrunk(),
    client.listSipDispatchRule(),
  ]);
  return trunks
    .flatMap((trunk) =>
      trunk.numbers.map((number) => {
        const rule = rules.find((r) => r.trunkIds.includes(trunk.sipTrunkId));
        return {
          agent: rule ? ruleAgent(rule) : null,
          dispatchRuleId: rule?.sipDispatchRuleId ?? null,
          number,
          trunkId: trunk.sipTrunkId,
        };
      })
    )
    .sort((a, b) => a.number.localeCompare(b.number));
}

async function findPhoneNumber(client: PhoneNumberClient, number: string) {
  const numbers = await listPhoneNumbers(client);
  const found = numbers.find((n) => n.number === number);
  if (!found) {
    throw new Error(`Phone number ${number} is not connected`);
  }
  const shared = numbers.some(
    (n) =>
      n.number !== number &&
      (n.trunkId === found.trunkId ||
        (found.dispatchRuleId !== null && n.dispatchRuleId === found.dispatchRuleId))
  );
  if (shared) {
    throw new Error(
      `Phone number ${number} shares a LiveKit trunk or dispatch rule with other numbers; change it with the LiveKit CLI`
    );
  }
  return found;
}

export async function addPhoneNumber(
  client: PhoneNumberClient,
  agentName: string,
  input: AddPhoneNumberInput
): Promise<PhoneNumber> {
  const { agent, number, ...auth } = addPhoneNumberInput.parse(input);
  const existing = await client.listSipInboundTrunk({ numbers: [number] });
  if (existing.length > 0) {
    throw new Error(`Phone number ${number} is already connected`);
  }
  const trunk = await client.createSipInboundTrunk(ruleName(number), [number], auth);
  try {
    const rule = await client.createSipDispatchRule(
      { roomPrefix: ROOM_PREFIX, type: "individual" },
      {
        name: ruleName(number),
        roomConfig: roomConfig(agentName, agent),
        trunkIds: [trunk.sipTrunkId],
      }
    );
    return { agent, dispatchRuleId: rule.sipDispatchRuleId, number, trunkId: trunk.sipTrunkId };
  } catch (error) {
    await client.deleteSipTrunk(trunk.sipTrunkId);
    throw error;
  }
}

export async function assignPhoneNumber(
  client: PhoneNumberClient,
  agentName: string,
  number: string,
  agent: string
): Promise<PhoneNumber> {
  const slug = agentSlugSchema.parse(agent);
  const found = await findPhoneNumber(client, phoneNumberSchema.parse(number));
  if (!found.dispatchRuleId) {
    const rule = await client.createSipDispatchRule(
      { roomPrefix: ROOM_PREFIX, type: "individual" },
      {
        name: ruleName(found.number),
        roomConfig: roomConfig(agentName, slug),
        trunkIds: [found.trunkId],
      }
    );
    return { ...found, agent: slug, dispatchRuleId: rule.sipDispatchRuleId };
  }
  const [rule] = await client.listSipDispatchRule({ dispatchRuleIds: [found.dispatchRuleId] });
  if (!rule) {
    throw new Error(`Dispatch rule ${found.dispatchRuleId} not found`);
  }
  rule.roomConfig = roomConfig(agentName, slug);
  await client.updateSipDispatchRule(found.dispatchRuleId, rule);
  return { ...found, agent: slug };
}

export async function connectPhoneNumber(
  client: PhoneNumberClient,
  agentName: string,
  input: AddPhoneNumberInput
): Promise<PhoneNumber> {
  const numbers = await listPhoneNumbers(client);
  return numbers.some((n) => n.number === input.number)
    ? assignPhoneNumber(client, agentName, input.number, input.agent)
    : addPhoneNumber(client, agentName, input);
}

export async function removePhoneNumber(client: PhoneNumberClient, number: string) {
  const found = await findPhoneNumber(client, phoneNumberSchema.parse(number));
  if (found.dispatchRuleId) {
    await client.deleteSipDispatchRule(found.dispatchRuleId);
  }
  await client.deleteSipTrunk(found.trunkId);
}
