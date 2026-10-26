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
  connectPhoneNumber,
  listPhoneNumbers,
  type PhoneNumberClient,
  removePhoneNumber,
  ruleAgent,
} from "./phone-numbers.ts";

const SCOPE = { legacyTenant: "default", tenant: "default" };
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
        metadata: opts?.metadata,
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
        metadata: opts?.metadata,
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
  const added = await addPhoneNumber(client, SCOPE, "answerline-wt1", {
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
    tenant: "default",
  });
  assert.deepEqual(await listPhoneNumbers(client, SCOPE), [added]);
});

test("add rejects invalid input and duplicates", async () => {
  const { client } = fakeClient();
  await assert.rejects(addPhoneNumber(client, SCOPE, "a", { agent: "x", number: "5551234567" }));
  await assert.rejects(addPhoneNumber(client, SCOPE, "a", { agent: "Bad Slug", number: NUMBER }));
  await addPhoneNumber(client, SCOPE, "a", { agent: "x", number: NUMBER });
  await assert.rejects(
    addPhoneNumber(client, SCOPE, "a", { agent: "y", number: NUMBER }),
    ALREADY_CONNECTED
  );
});

test("add removes the trunk when the dispatch rule cannot be created", async () => {
  const { client, trunks } = fakeClient();
  client.createSipDispatchRule = () => Promise.reject(new Error("boom"));
  await assert.rejects(addPhoneNumber(client, SCOPE, "a", { agent: "x", number: NUMBER }), BOOM);
  assert.equal(trunks.length, 0);
});

test("assign rewrites the dispatch rule's agent metadata", async () => {
  const { client, rules } = fakeClient();
  await addPhoneNumber(client, SCOPE, "answerline", { agent: "first", number: NUMBER });
  const assigned = await assignPhoneNumber(client, SCOPE, "answerline", NUMBER, "second");

  assert.equal(assigned.agent, "second");
  assert.equal(rules.length, 1);
  assert.equal(rules[0] && ruleAgent(rules[0]), "second");
  assert.equal(rules[0]?.rule?.rule.case, "dispatchRuleIndividual");
  assert.equal((await listPhoneNumbers(client, SCOPE))[0]?.agent, "second");
});

test("assign creates a dispatch rule for a trunk that has none", async () => {
  const { client, rules } = fakeClient();
  await client.createSipInboundTrunk("manual", [NUMBER]);
  const assigned = await assignPhoneNumber(client, SCOPE, "answerline", NUMBER, "front-desk");

  assert.equal(rules.length, 1);
  assert.equal(assigned.dispatchRuleId, rules[0]?.sipDispatchRuleId);
  assert.equal(assigned.agent, "front-desk");
});

test("connect adds a new number and reassigns an existing one", async () => {
  const { client, rules, trunks } = fakeClient();
  await connectPhoneNumber(client, SCOPE, "a", { agent: "first", number: NUMBER });
  const connected = await connectPhoneNumber(client, SCOPE, "a", {
    agent: "second",
    number: NUMBER,
  });

  assert.equal(trunks.length, 1);
  assert.equal(rules.length, 1);
  assert.equal(connected.agent, "second");
});

test("remove deletes the rule and trunk", async () => {
  const { client, rules, trunks } = fakeClient();
  await addPhoneNumber(client, SCOPE, "a", { agent: "x", number: NUMBER });
  await removePhoneNumber(client, SCOPE, NUMBER);
  assert.equal(rules.length, 0);
  assert.equal(trunks.length, 0);
  await assert.rejects(removePhoneNumber(client, SCOPE, NUMBER), NOT_CONNECTED);
});

test("numbers sharing a trunk are listed but not changed", async () => {
  const { client, trunks } = fakeClient();
  await client.createSipInboundTrunk("shared", [NUMBER, "+15557654321"]);
  assert.equal((await listPhoneNumbers(client, SCOPE)).length, 2);
  await assert.rejects(removePhoneNumber(client, SCOPE, NUMBER), SHARED);
  await assert.rejects(assignPhoneNumber(client, SCOPE, "a", NUMBER, "x"), SHARED);
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

test("workspace SIP lists and dispatches remain separate with identical agent slugs", async () => {
  const { client, rules, trunks } = fakeClient();
  const second = { legacyTenant: "default", tenant: "second" };
  const own = await addPhoneNumber(client, SCOPE, "answerline", { agent: "desk", number: NUMBER });
  const foreign = await addPhoneNumber(client, second, "answerline", {
    agent: "desk",
    number: "+15557654321",
  });
  assert.deepEqual(await listPhoneNumbers(client, SCOPE), [own]);
  assert.deepEqual(await listPhoneNumbers(client, second), [foreign]);
  assert.deepEqual(
    trunks.map((trunk) => JSON.parse(trunk.metadata)),
    [{ tenant: "default" }, { tenant: "second" }]
  );
  assert.deepEqual(
    rules.map((rule) => JSON.parse(rule.roomConfig?.agents[0]?.metadata ?? "")),
    [
      { agent: "desk", tenant: "default" },
      { agent: "desk", tenant: "second" },
    ]
  );
  const before = rules.map((rule) => rule.toJson());
  await assert.rejects(
    assignPhoneNumber(client, second, "answerline", NUMBER, "guessed"),
    NOT_CONNECTED
  );
  await assert.rejects(removePhoneNumber(client, second, NUMBER), NOT_CONNECTED);
  await assert.rejects(
    connectPhoneNumber(client, second, "answerline", { agent: "desk", number: NUMBER }),
    ALREADY_CONNECTED
  );
  await assert.rejects(
    addPhoneNumber(client, second, "answerline", { agent: "desk", number: NUMBER }),
    ALREADY_CONNECTED
  );
  assert.deepEqual(
    rules.map((rule) => rule.toJson()),
    before
  );
  assert.equal(trunks.length, 2);
});

test("untagged legacy trunks belong only to the configured deployment workspace", async () => {
  const { client } = fakeClient();
  const deployment = { legacyTenant: "deployment", tenant: "deployment" };
  const other = { legacyTenant: "deployment", tenant: "default" };
  await client.createSipInboundTrunk("legacy", [NUMBER]);
  assert.equal((await listPhoneNumbers(client, deployment)).length, 1);
  assert.deepEqual(await listPhoneNumbers(client, other), []);
  await assert.rejects(removePhoneNumber(client, other, NUMBER), NOT_CONNECTED);
  await assignPhoneNumber(client, deployment, "answerline", NUMBER, "desk");
  assert.equal((await listPhoneNumbers(client, deployment))[0]?.agent, "desk");
});

test("a dispatch rule shared with a foreign workspace blocks mutations globally", async () => {
  const { client, rules } = fakeClient();
  await addPhoneNumber(client, SCOPE, "answerline", { agent: "desk", number: NUMBER });
  const foreign = await client.createSipInboundTrunk("foreign", ["+15557654321"], {
    metadata: JSON.stringify({ tenant: "second" }),
  });
  const [rule] = rules;
  assert.ok(rule);
  rule.trunkIds.push(foreign.sipTrunkId);
  assert.equal((await listPhoneNumbers(client, SCOPE)).length, 1);
  await assert.rejects(removePhoneNumber(client, SCOPE, NUMBER), SHARED);
  await assert.rejects(assignPhoneNumber(client, SCOPE, "answerline", NUMBER, "other"), SHARED);
  assert.equal(rules.length, 1);
});

test("malformed ownership tags and conflicting rule ownership are never adopted", async () => {
  const { client, trunks, rules } = fakeClient();
  await addPhoneNumber(client, SCOPE, "answerline", { agent: "desk", number: NUMBER });
  const [trunk] = trunks;
  const [rule] = rules;
  assert.ok(trunk && rule);
  trunk.metadata = "not-json";
  assert.deepEqual(await listPhoneNumbers(client, SCOPE), []);
  await assert.rejects(removePhoneNumber(client, SCOPE, NUMBER), NOT_CONNECTED);
  trunk.metadata = JSON.stringify({ tenant: "default" });
  rule.metadata = JSON.stringify({ tenant: "second" });
  assert.equal((await listPhoneNumbers(client, SCOPE))[0]?.agent, null);
  await assert.rejects(assignPhoneNumber(client, SCOPE, "answerline", NUMBER, "other"), SHARED);
});

test("untagged dispatch rules mixing legacy and explicit workspaces cannot be changed", async () => {
  const { client, rules } = fakeClient();
  const scope = { legacyTenant: "default", tenant: "second" };
  await addPhoneNumber(client, scope, "answerline", { agent: "desk", number: NUMBER });
  const [rule] = rules;
  assert.ok(rule?.roomConfig);
  rule.metadata = "";
  rule.roomConfig.agents.push(
    new RoomAgentDispatch({ agentName: "legacy", metadata: JSON.stringify({ agent: "legacy" }) })
  );
  assert.equal((await listPhoneNumbers(client, scope))[0]?.agent, null);
  await assert.rejects(removePhoneNumber(client, scope, NUMBER), SHARED);
});
