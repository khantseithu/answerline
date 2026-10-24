import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoomAgentDispatch,
  RoomConfiguration,
  SIPDispatchRuleInfo,
  SIPInboundTrunkInfo,
} from "livekit-server-sdk";
import {
  addPhoneNumber,
  assignPhoneNumber,
  listPhoneNumbers,
  type PhoneNumberClient,
  removePhoneNumber,
  ruleAgent,
} from "./phone-numbers.ts";

const NUMBER = "+15551234567";
const ALREADY_CONNECTED = /already connected/;
const NOT_CONNECTED = /not connected/;
const SHARED = /shares a LiveKit trunk/;
const BOOM = /boom/;

function fakeClient() {
  const trunks: SIPInboundTrunkInfo[] = [];
  const rules: SIPDispatchRuleInfo[] = [];
  let seq = 0;
  const nextId = (prefix: string) => {
    seq += 1;
    return `${prefix}_${seq}`;
  };
  const client: PhoneNumberClient = {
    createSipDispatchRule: (rule, opts) => {
      const roomPrefix = rule.type === "individual" ? rule.roomPrefix : "";
      const info = new SIPDispatchRuleInfo({
        name: opts?.name,
        roomConfig: opts?.roomConfig,
        rule: { rule: { case: "dispatchRuleIndividual", value: { roomPrefix } } },
        sipDispatchRuleId: nextId("SDR"),
        trunkIds: opts?.trunkIds ?? [],
      });
      rules.push(info);
      return Promise.resolve(info);
    },
    createSipInboundTrunk: (name, numbers, opts) => {
      const info = new SIPInboundTrunkInfo({
        allowedAddresses: opts?.allowedAddresses ?? [],
        name,
        numbers,
        sipTrunkId: nextId("ST"),
      });
      trunks.push(info);
      return Promise.resolve(info);
    },
    deleteSipDispatchRule: (id) => {
      const index = rules.findIndex((r) => r.sipDispatchRuleId === id);
      const [removed] = rules.splice(index, 1);
      return Promise.resolve(removed as SIPDispatchRuleInfo);
    },
    deleteSipTrunk: (id) => {
      const index = trunks.findIndex((t) => t.sipTrunkId === id);
      trunks.splice(index, 1);
      return Promise.resolve({} as Awaited<ReturnType<PhoneNumberClient["deleteSipTrunk"]>>);
    },
    listSipDispatchRule: (opts) =>
      Promise.resolve(
        rules.filter(
          (r) => !opts?.dispatchRuleIds || opts.dispatchRuleIds.includes(r.sipDispatchRuleId)
        )
      ),
    listSipInboundTrunk: (opts) =>
      Promise.resolve(
        trunks.filter((t) => !opts?.numbers || t.numbers.some((n) => opts.numbers?.includes(n)))
      ),
    updateSipDispatchRule: (id, rule) => {
      const index = rules.findIndex((r) => r.sipDispatchRuleId === id);
      rules[index] = rule;
      return Promise.resolve(rule);
    },
  };
  return { client, rules, trunks };
}

test("add creates one trunk and one individual dispatch rule carrying the agent slug", async () => {
  const { client, rules, trunks } = fakeClient();
  const added = await addPhoneNumber(client, "answerline-wt1", {
    agent: "bright-smile-dental",
    allowedAddresses: ["54.172.60.0/30"],
    number: NUMBER,
  });

  assert.equal(trunks.length, 1);
  assert.deepEqual(trunks[0]?.numbers, [NUMBER]);
  assert.deepEqual(trunks[0]?.allowedAddresses, ["54.172.60.0/30"]);
  assert.equal(rules.length, 1);
  const [rule] = rules;
  assert.deepEqual(rule?.trunkIds, [added.trunkId]);
  assert.equal(rule?.rule?.rule.case, "dispatchRuleIndividual");
  assert.equal(rule?.rule?.rule.value?.roomPrefix, "call-");
  assert.equal(rule?.roomConfig?.agents[0]?.agentName, "answerline-wt1");
  assert.deepEqual(JSON.parse(rule?.roomConfig?.agents[0]?.metadata ?? ""), {
    agent: "bright-smile-dental",
  });
  assert.deepEqual(await listPhoneNumbers(client), [added]);
});

test("add rejects invalid input and duplicates", async () => {
  const { client } = fakeClient();
  await assert.rejects(addPhoneNumber(client, "a", { agent: "x", number: "5551234567" }));
  await assert.rejects(addPhoneNumber(client, "a", { agent: "Bad Slug", number: NUMBER }));
  await addPhoneNumber(client, "a", { agent: "x", number: NUMBER });
  await assert.rejects(
    addPhoneNumber(client, "a", { agent: "y", number: NUMBER }),
    ALREADY_CONNECTED
  );
});

test("add removes the trunk when the dispatch rule cannot be created", async () => {
  const { client, trunks } = fakeClient();
  client.createSipDispatchRule = () => Promise.reject(new Error("boom"));
  await assert.rejects(addPhoneNumber(client, "a", { agent: "x", number: NUMBER }), BOOM);
  assert.equal(trunks.length, 0);
});

test("assign rewrites the dispatch rule's agent metadata", async () => {
  const { client, rules } = fakeClient();
  await addPhoneNumber(client, "answerline", { agent: "first", number: NUMBER });
  const assigned = await assignPhoneNumber(client, "answerline", NUMBER, "second");

  assert.equal(assigned.agent, "second");
  assert.equal(rules.length, 1);
  assert.equal(rules[0] && ruleAgent(rules[0]), "second");
  assert.equal(rules[0]?.rule?.rule.case, "dispatchRuleIndividual");
  assert.equal((await listPhoneNumbers(client))[0]?.agent, "second");
});

test("assign creates a dispatch rule for a trunk that has none", async () => {
  const { client, rules } = fakeClient();
  await client.createSipInboundTrunk("manual", [NUMBER]);
  const assigned = await assignPhoneNumber(client, "answerline", NUMBER, "front-desk");

  assert.equal(rules.length, 1);
  assert.equal(assigned.dispatchRuleId, rules[0]?.sipDispatchRuleId);
  assert.equal(assigned.agent, "front-desk");
});

test("remove deletes the rule and trunk", async () => {
  const { client, rules, trunks } = fakeClient();
  await addPhoneNumber(client, "a", { agent: "x", number: NUMBER });
  await removePhoneNumber(client, NUMBER);
  assert.equal(rules.length, 0);
  assert.equal(trunks.length, 0);
  await assert.rejects(removePhoneNumber(client, NUMBER), NOT_CONNECTED);
});

test("numbers sharing a trunk are listed but not changed", async () => {
  const { client, trunks } = fakeClient();
  await client.createSipInboundTrunk("shared", [NUMBER, "+15557654321"]);
  assert.equal((await listPhoneNumbers(client)).length, 2);
  await assert.rejects(removePhoneNumber(client, NUMBER), SHARED);
  await assert.rejects(assignPhoneNumber(client, "a", NUMBER, "x"), SHARED);
  assert.equal(trunks.length, 1);
});

test("ruleAgent ignores dispatches without an agent slug", () => {
  const rule = new SIPDispatchRuleInfo({
    roomConfig: new RoomConfiguration({
      agents: [
        new RoomAgentDispatch({ agentName: "other", metadata: "not json" }),
        new RoomAgentDispatch({ agentName: "answerline", metadata: '{"agent":"desk"}' }),
      ],
    }),
  });
  assert.equal(ruleAgent(rule), "desk");
  assert.equal(ruleAgent(new SIPDispatchRuleInfo()), null);
});
