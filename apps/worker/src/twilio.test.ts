import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTwilioTrunk } from "./twilio.ts";

const NUMBER = "+15551234567";
const OPTIONS = {
  accountSid: "AC1",
  authToken: "token",
  number: NUMBER,
  sipHost: "sip.example.com",
};
const NOT_IN_ACCOUNT = /not a phone number in this Twilio account/;
const OTHER_TRUNK = /attached to Twilio trunk TK_OTHER/;
const UNAUTHORIZED = /Twilio 401/;

interface Recorded {
  form: Record<string, string> | null;
  method: string;
  url: string;
}

function fakeTwilio(state: {
  numberTrunk?: string | null;
  numbers?: string[];
  originations?: string[];
  status?: number;
  trunks?: { friendly_name: string; sid: string }[];
}) {
  const calls: Recorded[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const form = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
    calls.push({ form, method, url });
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: state.status ?? 200 }));
    const { pathname } = new URL(url);
    if (pathname === "/v1/Trunks" && method === "GET") {
      return json({ trunks: state.trunks ?? [] });
    }
    if (method === "POST" && pathname === "/v1/Trunks") {
      return json({ sid: "TK_NEW" });
    }
    const segments = pathname.split("/");
    if (method === "POST" && segments.length === 4) {
      return json({ sid: segments[3] });
    }
    if (pathname.endsWith("/OriginationUrls") && method === "GET") {
      return json({ origination_urls: (state.originations ?? []).map((sip_url) => ({ sip_url })) });
    }
    if (pathname.endsWith("/IncomingPhoneNumbers.json")) {
      return json({
        incoming_phone_numbers: (state.numbers ?? [NUMBER]).map((phone_number) => ({
          phone_number,
          sid: "PN1",
          trunk_sid: state.numberTrunk ?? null,
        })),
      });
    }
    return json({});
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

test("creates a transfer-enabled trunk, origination URL, and attaches the number", async () => {
  const { calls, fetchImpl } = fakeTwilio({});
  const result = await setupTwilioTrunk(OPTIONS, fetchImpl);

  assert.deepEqual(result, {
    originationUrl: "sip:sip.example.com;transport=tcp",
    phoneNumberSid: "PN1",
    trunkSid: "TK_NEW",
  });
  const posts = calls.filter((c) => c.method === "POST");
  assert.deepEqual(
    posts.map((c) => [new URL(c.url).pathname, c.form]),
    [
      [
        "/v1/Trunks",
        {
          FriendlyName: "answerline",
          TransferCallerId: "from-transferee",
          TransferMode: "enable-all",
        },
      ],
      [
        "/v1/Trunks/TK_NEW/OriginationUrls",
        {
          Enabled: "true",
          FriendlyName: "Answerline LiveKit SIP",
          Priority: "1",
          SipUrl: "sip:sip.example.com;transport=tcp",
          Weight: "1",
        },
      ],
      ["/v1/Trunks/TK_NEW/PhoneNumbers", { PhoneNumberSid: "PN1" }],
    ]
  );
  const lookup = calls.find((c) => c.url.includes("IncomingPhoneNumbers"));
  assert.equal(
    lookup?.url,
    "https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json?PhoneNumber=%2B15551234567"
  );
});

test("reuses an existing trunk and only re-enables transfers", async () => {
  const { calls, fetchImpl } = fakeTwilio({
    numberTrunk: "TK_EXISTING",
    originations: ["sip:sip.example.com;transport=tcp"],
    trunks: [{ friendly_name: "answerline", sid: "TK_EXISTING" }],
  });
  const result = await setupTwilioTrunk(OPTIONS, fetchImpl);

  assert.equal(result.trunkSid, "TK_EXISTING");
  const posts = calls.filter((c) => c.method === "POST");
  assert.deepEqual(
    posts.map((c) => [new URL(c.url).pathname, c.form]),
    [
      [
        "/v1/Trunks/TK_EXISTING",
        { TransferCallerId: "from-transferee", TransferMode: "enable-all" },
      ],
    ]
  );
});

test("sends basic auth with the account credentials", async () => {
  const { fetchImpl } = fakeTwilio({});
  let header: string | null = null;
  await setupTwilioTrunk(OPTIONS, (input, init) => {
    header = new Headers(init?.headers).get("authorization");
    return fetchImpl(input, init);
  });
  assert.equal(header, `Basic ${Buffer.from("AC1:token").toString("base64")}`);
});

test("fails when the number is not in the account or is on another trunk", async () => {
  await assert.rejects(
    setupTwilioTrunk(OPTIONS, fakeTwilio({ numbers: [] }).fetchImpl),
    NOT_IN_ACCOUNT
  );
  await assert.rejects(
    setupTwilioTrunk(OPTIONS, fakeTwilio({ numberTrunk: "TK_OTHER" }).fetchImpl),
    OTHER_TRUNK
  );
});

test("surfaces Twilio API errors", async () => {
  await assert.rejects(
    setupTwilioTrunk(OPTIONS, fakeTwilio({ status: 401 }).fetchImpl),
    UNAUTHORIZED
  );
});
