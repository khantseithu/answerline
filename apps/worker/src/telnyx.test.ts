import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTelnyxConnection } from "./telnyx.ts";

const NUMBER = "+15551234567";
const OPTIONS = { apiKey: "KEY", number: NUMBER, sipHost: "sip.example.com" };
const NEEDS_DNS = /needs a DNS name/;
const NOT_IN_ACCOUNT = /not a phone number in this Telnyx account/;
const OTHER_CONNECTION = /assigned to Telnyx connection OTHER/;
const UNAUTHORIZED = /Telnyx 401/;

interface Recorded {
  body: unknown;
  method: string;
  url: string;
}

function fakeTelnyx(state: {
  connections?: { connection_name: string; id: string }[];
  fqdns?: string[];
  numberConnection?: string | null;
  numbers?: string[];
  status?: number;
}) {
  const calls: Recorded[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method, url });
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: state.status ?? 200 }));
    const { pathname } = new URL(url);
    if (pathname === "/v2/fqdn_connections" && method === "GET") {
      return json({ data: state.connections ?? [] });
    }
    if (pathname === "/v2/fqdn_connections") {
      return json({ data: { id: "CONN_NEW" } });
    }
    if (pathname === "/v2/fqdns" && method === "GET") {
      return json({ data: (state.fqdns ?? []).map((fqdn) => ({ fqdn })) });
    }
    if (pathname === "/v2/phone_numbers") {
      return json({
        data: (state.numbers ?? [NUMBER]).map((phone_number) => ({
          connection_id: state.numberConnection ?? null,
          id: "PN1",
          phone_number,
        })),
      });
    }
    return json({ data: {} });
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

const writes = (calls: Recorded[]) =>
  calls.filter((c) => c.method !== "GET").map((c) => [c.method, new URL(c.url).pathname, c.body]);

test("creates a TCP FQDN connection, adds the SIP host, and assigns the number", async () => {
  const { calls, fetchImpl } = fakeTelnyx({});
  const result = await setupTelnyxConnection(OPTIONS, fetchImpl);

  assert.deepEqual(result, { connectionId: "CONN_NEW", phoneNumberId: "PN1" });
  assert.deepEqual(writes(calls), [
    [
      "POST",
      "/v2/fqdn_connections",
      {
        active: true,
        anchorsite_override: "Latency",
        connection_name: "answerline",
        inbound: { ani_number_format: "+E.164", dnis_number_format: "+e164" },
        transport_protocol: "TCP",
      },
    ],
    [
      "POST",
      "/v2/fqdns",
      { connection_id: "CONN_NEW", dns_record_type: "a", fqdn: "sip.example.com", port: 5060 },
    ],
    ["PATCH", "/v2/phone_numbers/PN1", { connection_id: "CONN_NEW" }],
  ]);
  const lookup = calls.find((c) => c.url.includes("/phone_numbers?"));
  assert.equal(
    lookup?.url,
    "https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=%2B15551234567"
  );
});

test("re-running against an existing setup changes nothing", async () => {
  const { calls, fetchImpl } = fakeTelnyx({
    connections: [
      { connection_name: "answerline-old", id: "CONN_OLD" },
      { connection_name: "answerline", id: "CONN_1" },
    ],
    fqdns: ["sip.example.com"],
    numberConnection: "CONN_1",
  });
  const result = await setupTelnyxConnection(OPTIONS, fetchImpl);

  assert.equal(result.connectionId, "CONN_1");
  assert.deepEqual(writes(calls), []);
});

test("sends the API key as a bearer token", async () => {
  const { fetchImpl } = fakeTelnyx({});
  let header: string | null = null;
  await setupTelnyxConnection(OPTIONS, (input, init) => {
    header = new Headers(init?.headers).get("authorization");
    return fetchImpl(input, init);
  });
  assert.equal(header, "Bearer KEY");
});

test("rejects an IP host, a missing number, and a number on another connection", async () => {
  await assert.rejects(
    setupTelnyxConnection({ ...OPTIONS, sipHost: "203.0.113.10" }, fakeTelnyx({}).fetchImpl),
    NEEDS_DNS
  );
  await assert.rejects(
    setupTelnyxConnection(OPTIONS, fakeTelnyx({ numbers: [] }).fetchImpl),
    NOT_IN_ACCOUNT
  );
  await assert.rejects(
    setupTelnyxConnection(OPTIONS, fakeTelnyx({ numberConnection: "OTHER" }).fetchImpl),
    OTHER_CONNECTION
  );
});

test("surfaces Telnyx API errors", async () => {
  await assert.rejects(
    setupTelnyxConnection(OPTIONS, fakeTelnyx({ status: 401 }).fetchImpl),
    UNAUTHORIZED
  );
});
