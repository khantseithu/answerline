import { z } from "zod";

export interface TwilioSetupOptions {
  accountSid: string;
  authToken: string;
  number: string;
  sipHost: string;
  trunkName?: string;
}

export interface TwilioSetupResult {
  originationUrl: string;
  phoneNumberSid: string;
  trunkSid: string;
}

const TRUNKING_API = "https://trunking.twilio.com/v1";
const API = "https://api.twilio.com/2010-04-01";
export const DEFAULT_TRUNK_NAME = "answerline";

const trunkList = z.object({
  trunks: z.array(z.object({ friendly_name: z.string(), sid: z.string() })),
});
const trunk = z.object({ sid: z.string() });
const originationList = z.object({ origination_urls: z.array(z.object({ sip_url: z.string() })) });
const numberList = z.object({
  incoming_phone_numbers: z.array(
    z.object({ phone_number: z.string(), sid: z.string(), trunk_sid: z.string().nullable() })
  ),
});

export const twilioEnvSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
});

export async function setupTwilioTrunk(
  options: TwilioSetupOptions,
  fetchImpl: typeof fetch = fetch
): Promise<TwilioSetupResult> {
  const authorization = `Basic ${Buffer.from(`${options.accountSid}:${options.authToken}`).toString("base64")}`;

  async function call<T>(schema: z.ZodType<T>, url: string, form?: Record<string, string>) {
    const response = await fetchImpl(url, {
      body: form ? new URLSearchParams(form) : undefined,
      headers: { authorization },
      method: form ? "POST" : "GET",
    });
    if (!response.ok) {
      throw new Error(`Twilio ${response.status} for ${url}: ${await response.text()}`);
    }
    return schema.parse(await response.json());
  }

  const name = options.trunkName ?? DEFAULT_TRUNK_NAME;
  const transfer = { TransferCallerId: "from-transferee", TransferMode: "enable-all" };
  const { trunks } = await call(trunkList, `${TRUNKING_API}/Trunks?PageSize=1000`);
  const existing = trunks.find((t) => t.friendly_name === name);
  const { sid: trunkSid } = existing
    ? await call(trunk, `${TRUNKING_API}/Trunks/${existing.sid}`, transfer)
    : await call(trunk, `${TRUNKING_API}/Trunks`, { FriendlyName: name, ...transfer });

  const originationUrl = `sip:${options.sipHost};transport=tcp`;
  const { origination_urls } = await call(
    originationList,
    `${TRUNKING_API}/Trunks/${trunkSid}/OriginationUrls?PageSize=1000`
  );
  if (!origination_urls.some((o) => o.sip_url === originationUrl)) {
    await call(z.unknown(), `${TRUNKING_API}/Trunks/${trunkSid}/OriginationUrls`, {
      Enabled: "true",
      FriendlyName: "Answerline LiveKit SIP",
      Priority: "1",
      SipUrl: originationUrl,
      Weight: "1",
    });
  }

  const { incoming_phone_numbers } = await call(
    numberList,
    `${API}/Accounts/${options.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(options.number)}`
  );
  const phoneNumber = incoming_phone_numbers.find((n) => n.phone_number === options.number);
  if (!phoneNumber) {
    throw new Error(`${options.number} is not a phone number in this Twilio account`);
  }
  if (phoneNumber.trunk_sid && phoneNumber.trunk_sid !== trunkSid) {
    throw new Error(
      `${options.number} is attached to Twilio trunk ${phoneNumber.trunk_sid}; remove it there first`
    );
  }
  if (!phoneNumber.trunk_sid) {
    await call(z.unknown(), `${TRUNKING_API}/Trunks/${trunkSid}/PhoneNumbers`, {
      PhoneNumberSid: phoneNumber.sid,
    });
  }

  return { originationUrl, phoneNumberSid: phoneNumber.sid, trunkSid };
}
