import assert from "node:assert/strict";
import { test } from "node:test";
import type { PhoneNumberClient } from "@answerline/worker/phone-numbers";
import { SIPDispatchRuleInfo, SIPInboundTrunkInfo } from "livekit-server-sdk";
import { createPhoneNumberHandlers } from "./handlers.ts";
import type { PhoneNumberDeps } from "./service.ts";

const NUMBER = "+15550003333";
const ALREADY_CONNECTED = /already connected/;
const SHARED_TRUNK = /shares a LiveKit trunk/;
const SIP_SERVICE = /SIP service/;
const AGENTS = [
  { name: "Bright Smile Dental", slug: "bright-smile-dental" },
  { name: "Harbor Plumbing", slug: "harbor-plumbing" },
];

function fakeClient(options: { down?: boolean } = {}) {
  const trunks: SIPInboundTrunkInfo[] = [];
  const rules: SIPDispatchRuleInfo[] = [];
  let seq = 0;
  const unreachable = () => Promise.reject(new TypeError("fetch failed"));
  const guard = <T>(run: () => T) => (options.down ? unreachable() : Promise.resolve(run()));
  const client: PhoneNumberClient = {
    createSipDispatchRule: (rule, opts) =>
      guard(() => {
        seq += 1;
        const info = new SIPDispatchRuleInfo({
          name: opts?.name,
          roomConfig: opts?.roomConfig,
          rule: {
            rule: {
              case: "dispatchRuleIndividual",
              value: { roomPrefix: rule.type === "individual" ? rule.roomPrefix : "" },
            },
          },
          sipDispatchRuleId: `SDR_${seq}`,
          trunkIds: opts?.trunkIds ?? [],
        });
        rules.push(info);
        return info;
      }),
    createSipInboundTrunk: (name, numbers) =>
      guard(() => {
        seq += 1;
        const info = new SIPInboundTrunkInfo({ name, numbers, sipTrunkId: `ST_${seq}` });
        trunks.push(info);
        return info;
      }),
    deleteSipDispatchRule: (id) =>
      guard(() => {
        const [removed] = rules.splice(
          rules.findIndex((r) => r.sipDispatchRuleId === id),
          1
        );
        return removed as SIPDispatchRuleInfo;
      }),
    deleteSipTrunk: (id) =>
      guard(() => {
        trunks.splice(
          trunks.findIndex((t) => t.sipTrunkId === id),
          1
        );
        return {} as Awaited<ReturnType<PhoneNumberClient["deleteSipTrunk"]>>;
      }),
    listSipDispatchRule: (opts) =>
      guard(() =>
        rules.filter(
          (r) => !opts?.dispatchRuleIds || opts.dispatchRuleIds.includes(r.sipDispatchRuleId)
        )
      ),
    listSipInboundTrunk: (opts) =>
      guard(() =>
        trunks.filter((t) => !opts?.numbers || t.numbers.some((n) => opts.numbers?.includes(n)))
      ),
    updateSipDispatchRule: (id, rule) =>
      guard(() => {
        rules[rules.findIndex((r) => r.sipDispatchRuleId === id)] = rule;
        return rule;
      }),
  };
  return { client, rules, trunks };
}

function harness(options: { down?: boolean } = {}) {
  const fake = fakeClient(options);
  const deps: PhoneNumberDeps = {
    agentName: "answerline-test",
    client: fake.client,
    listAgents: () => Promise.resolve(AGENTS),
  };
  return { ...fake, handlers: createPhoneNumberHandlers(() => Promise.resolve(deps)) };
}

const post = (body: unknown) =>
  new Request("http://test/api/v1/phone-numbers", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    method: "POST",
  });
const patch = (body: unknown) =>
  new Request("http://test/api/v1/phone-numbers/x", {
    body: JSON.stringify(body),
    method: "PATCH",
  });
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;
const encoded = encodeURIComponent(NUMBER);

test("connect, list, reassign and disconnect a number", async () => {
  const { handlers, rules, trunks } = harness();

  const created = await handlers.create(post({ agent: "bright-smile-dental", number: NUMBER }));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { agent: "bright-smile-dental", number: NUMBER });
  assert.equal(trunks.length, 1);
  assert.equal(rules[0]?.roomConfig?.agents[0]?.agentName, "answerline-test");

  const listed = await handlers.list();
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), {
    agents: AGENTS,
    numbers: [{ agent: "bright-smile-dental", number: NUMBER }],
  });

  const assigned = await handlers.assign(patch({ agent: "harbor-plumbing" }), encoded);
  assert.equal(assigned.status, 200);
  assert.deepEqual(await assigned.json(), { agent: "harbor-plumbing", number: NUMBER });
  assert.deepEqual(JSON.parse(rules[0]?.roomConfig?.agents[0]?.metadata ?? ""), {
    agent: "harbor-plumbing",
  });

  const removed = await handlers.remove(new Request("http://test", { method: "DELETE" }), encoded);
  assert.equal(removed.status, 204);
  assert.equal(trunks.length, 0);
  assert.equal(rules.length, 0);
});

test("rejects invalid input with 400", async () => {
  const { handlers } = harness();
  const cases = [
    await handlers.create(post({ agent: "bright-smile-dental", number: "5550003333" })),
    await handlers.create(post({ agent: "Bad Slug", number: NUMBER })),
    await handlers.create(post({ agent: "ghost-agent", number: NUMBER })),
    await handlers.create(post({ agent: "harbor-plumbing", extra: 1, number: NUMBER })),
    await handlers.create(post("not json")),
    await handlers.assign(patch({ agent: "harbor-plumbing" }), "5550003333"),
    await handlers.assign(patch({ agent: "harbor-plumbing" }), "%E0%A4%A"),
    await handlers.assign(patch({ agent: "ghost-agent" }), encoded),
    await handlers.remove(new Request("http://test", { method: "DELETE" }), "nope"),
  ];
  const messages = await Promise.all(cases.map(errorOf));
  for (const [index, response] of cases.entries()) {
    assert.equal(response.status, 400);
    assert.ok(messages[index]);
  }
});

test("a duplicate number is a 409", async () => {
  const { handlers } = harness();
  const body = { agent: "bright-smile-dental", number: NUMBER };
  assert.equal((await handlers.create(post(body))).status, 201);
  const duplicate = await handlers.create(post(body));
  assert.equal(duplicate.status, 409);
  assert.match(await errorOf(duplicate), ALREADY_CONNECTED);
});

test("a number sharing a trunk with another is a 409", async () => {
  const { client, handlers } = harness();
  const trunk = await client.createSipInboundTrunk("shared", [NUMBER, "+15550004444"]);
  await client.createSipDispatchRule(
    { roomPrefix: "call-", type: "individual" },
    { trunkIds: [trunk.sipTrunkId] }
  );
  const response = await handlers.assign(patch({ agent: "harbor-plumbing" }), encoded);
  assert.equal(response.status, 409);
  assert.match(await errorOf(response), SHARED_TRUNK);
});

test("an unknown number is a 404", async () => {
  const { handlers } = harness();
  const assigned = await handlers.assign(patch({ agent: "harbor-plumbing" }), encoded);
  assert.equal(assigned.status, 404);
  const removed = await handlers.remove(new Request("http://test", { method: "DELETE" }), encoded);
  assert.equal(removed.status, 404);
});

test("an unreachable SIP service is a 502 with a clear message", async () => {
  const { handlers } = harness({ down: true });
  const responses = [
    await handlers.list(),
    await handlers.create(post({ agent: "bright-smile-dental", number: NUMBER })),
    await handlers.assign(patch({ agent: "harbor-plumbing" }), encoded),
    await handlers.remove(new Request("http://test", { method: "DELETE" }), encoded),
  ];
  const messages = await Promise.all(responses.map(errorOf));
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 502);
    assert.match(messages[index] ?? "", SIP_SERVICE);
  }
});

test("unexpected failures are a generic 500", async () => {
  const handlers = createPhoneNumberHandlers(() => Promise.reject(new Error("db exploded")));
  const response = await handlers.list();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
});
