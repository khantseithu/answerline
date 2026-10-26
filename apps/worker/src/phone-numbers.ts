import { callDispatchMetadataSchema } from "@answerline/shared";
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
  TENANT: agentSlugSchema.default("default"),
});

export function createPhoneNumberClient(env: z.infer<typeof sipEnvSchema>): PhoneNumberClient {
  const url = env.LIVEKIT_URL.replace(WS_SCHEME, "http");
  return new SipClient(url, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

const ruleName = (number: string) => `answerline ${number}`;

export interface PhoneNumberScope {
  legacyTenant: string;
  tenant: string;
}

function roomConfig(agentName: string, agent: string, tenant: string) {
  return new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName,
        metadata: JSON.stringify(callDispatchMetadataSchema.parse({ agent, tenant })),
      }),
    ],
  });
}

const dispatchMetadata = z.object({ agent: agentSlugSchema });
const resourceMetadata = z.strictObject({ tenant: agentSlugSchema });

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

function resourceTenant(metadata: string, legacyTenant: string) {
  if (!metadata) {
    return legacyTenant;
  }
  const parsed = resourceMetadata.safeParse(parseJson(metadata));
  return parsed.success ? parsed.data.tenant : null;
}

function ruleTenant(rule: SIPDispatchRuleInfo, legacyTenant: string) {
  const tenants = new Set<string>();
  for (const dispatch of rule.roomConfig?.agents ?? []) {
    const data = parseJson(dispatch.metadata);
    const scoped = callDispatchMetadataSchema.safeParse(data);
    if (scoped.success) {
      tenants.add(scoped.data.tenant);
    } else if (data && typeof data === "object" && "tenant" in data) {
      return null;
    } else if (!rule.metadata) {
      tenants.add(legacyTenant);
    }
  }
  if (rule.metadata || tenants.size === 0) {
    const owner = resourceTenant(rule.metadata, legacyTenant);
    return owner && [...tenants].every((tenant) => tenant === owner) ? owner : null;
  }
  return tenants.size === 1 ? [...tenants][0] : null;
}

async function phoneResources(client: PhoneNumberClient) {
  const [trunks, rules] = await Promise.all([
    client.listSipInboundTrunk(),
    client.listSipDispatchRule(),
  ]);
  return { rules, trunks };
}

function scopedNumbers(
  { trunks, rules }: Awaited<ReturnType<typeof phoneResources>>,
  scope: PhoneNumberScope
) {
  agentSlugSchema.parse(scope.tenant);
  agentSlugSchema.parse(scope.legacyTenant);
  return trunks
    .filter((trunk) => resourceTenant(trunk.metadata, scope.legacyTenant) === scope.tenant)
    .flatMap((trunk) =>
      trunk.numbers.map((number) => {
        const rule = rules.find(
          (r) =>
            r.trunkIds.includes(trunk.sipTrunkId) &&
            ruleTenant(r, scope.legacyTenant) === scope.tenant
        );
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

export async function listPhoneNumbers(client: PhoneNumberClient, scope: PhoneNumberScope) {
  return scopedNumbers(await phoneResources(client), scope);
}

async function findPhoneNumber(client: PhoneNumberClient, scope: PhoneNumberScope, number: string) {
  const resources = await phoneResources(client);
  const found = scopedNumbers(resources, scope).find((n) => n.number === number);
  if (!found) {
    throw new Error(`Phone number ${number} is not connected`);
  }
  const trunk = resources.trunks.find((t) => t.sipTrunkId === found.trunkId);
  const linkedRules = resources.rules.filter(
    (r) => r.trunkIds.length === 0 || r.trunkIds.includes(found.trunkId)
  );
  const shared =
    trunk?.numbers.length !== 1 ||
    resources.trunks.some((t) => t.sipTrunkId !== found.trunkId && t.numbers.includes(number)) ||
    linkedRules.length > 1 ||
    linkedRules.some(
      (rule) => rule.trunkIds.length !== 1 || ruleTenant(rule, scope.legacyTenant) !== scope.tenant
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
  scope: PhoneNumberScope,
  agentName: string,
  input: AddPhoneNumberInput
): Promise<PhoneNumber> {
  const { agent, number, ...auth } = addPhoneNumberInput.parse(input);
  const existing = await client.listSipInboundTrunk({ numbers: [number] });
  if (existing.length > 0) {
    throw new Error(`Phone number ${number} is already connected`);
  }
  const trunk = await client.createSipInboundTrunk(ruleName(number), [number], {
    ...auth,
    metadata: JSON.stringify(resourceMetadata.parse({ tenant: scope.tenant })),
  });
  try {
    const rule = await client.createSipDispatchRule(
      { roomPrefix: ROOM_PREFIX, type: "individual" },
      {
        metadata: JSON.stringify({ tenant: scope.tenant }),
        name: ruleName(number),
        roomConfig: roomConfig(agentName, agent, scope.tenant),
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
  scope: PhoneNumberScope,
  agentName: string,
  number: string,
  agent: string
): Promise<PhoneNumber> {
  const slug = agentSlugSchema.parse(agent);
  const found = await findPhoneNumber(client, scope, phoneNumberSchema.parse(number));
  if (!found.dispatchRuleId) {
    const rule = await client.createSipDispatchRule(
      { roomPrefix: ROOM_PREFIX, type: "individual" },
      {
        metadata: JSON.stringify({ tenant: scope.tenant }),
        name: ruleName(found.number),
        roomConfig: roomConfig(agentName, slug, scope.tenant),
        trunkIds: [found.trunkId],
      }
    );
    return { ...found, agent: slug, dispatchRuleId: rule.sipDispatchRuleId };
  }
  const [rule] = await client.listSipDispatchRule({ dispatchRuleIds: [found.dispatchRuleId] });
  if (!rule || ruleTenant(rule, scope.legacyTenant) !== scope.tenant) {
    throw new Error(`Phone number ${number} is not connected`);
  }
  rule.roomConfig = roomConfig(agentName, slug, scope.tenant);
  rule.metadata = JSON.stringify({ tenant: scope.tenant });
  await client.updateSipDispatchRule(found.dispatchRuleId, rule);
  return { ...found, agent: slug };
}

export async function connectPhoneNumber(
  client: PhoneNumberClient,
  scope: PhoneNumberScope,
  agentName: string,
  input: AddPhoneNumberInput
): Promise<PhoneNumber> {
  const numbers = await listPhoneNumbers(client, scope);
  return numbers.some((n) => n.number === input.number)
    ? assignPhoneNumber(client, scope, agentName, input.number, input.agent)
    : addPhoneNumber(client, scope, agentName, input);
}

export async function removePhoneNumber(
  client: PhoneNumberClient,
  scope: PhoneNumberScope,
  number: string
) {
  const found = await findPhoneNumber(client, scope, phoneNumberSchema.parse(number));
  if (found.dispatchRuleId) {
    await client.deleteSipDispatchRule(found.dispatchRuleId);
  }
  await client.deleteSipTrunk(found.trunkId);
}
