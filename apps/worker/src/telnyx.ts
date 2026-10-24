import { z } from "zod";

export interface TelnyxSetupOptions {
  apiKey: string;
  connectionName?: string;
  number: string;
  sipHost: string;
}

export interface TelnyxSetupResult {
  connectionId: string;
  phoneNumberId: string;
}

const API = "https://api.telnyx.com/v2";
const SIP_PORT = 5060;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
export const DEFAULT_CONNECTION_NAME = "answerline";

const connectionList = z.object({
  data: z.array(z.object({ connection_name: z.string(), id: z.string() })),
});
const connection = z.object({ data: z.object({ id: z.string() }) });
const fqdnList = z.object({ data: z.array(z.object({ fqdn: z.string() })) });
const numberList = z.object({
  data: z.array(
    z.object({ connection_id: z.string().nullable(), id: z.string(), phone_number: z.string() })
  ),
});

export const telnyxEnvSchema = z.object({
  TELNYX_API_KEY: z.string().min(1, "TELNYX_API_KEY is required"),
});

export async function setupTelnyxConnection(
  options: TelnyxSetupOptions,
  fetchImpl: typeof fetch = fetch
): Promise<TelnyxSetupResult> {
  if (IPV4.test(options.sipHost)) {
    throw new Error("Telnyx needs a DNS name for the SIP host; point an A record at the IP");
  }

  async function call<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown) {
    const response = await fetchImpl(`${API}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      method,
    });
    if (!response.ok) {
      throw new Error(`Telnyx ${response.status} for ${method} ${path}: ${await response.text()}`);
    }
    return schema.parse(await response.json());
  }

  const name = options.connectionName ?? DEFAULT_CONNECTION_NAME;
  const connections = await call(
    connectionList,
    "GET",
    `/fqdn_connections?filter[connection_name][contains]=${encodeURIComponent(name)}`
  );
  const existing = connections.data.find((c) => c.connection_name === name);
  const connectionId =
    existing?.id ??
    (
      await call(connection, "POST", "/fqdn_connections", {
        active: true,
        anchorsite_override: "Latency",
        connection_name: name,
        inbound: { ani_number_format: "+E.164", dnis_number_format: "+e164" },
        transport_protocol: "TCP",
      })
    ).data.id;

  const fqdns = await call(fqdnList, "GET", `/fqdns?filter[connection_id]=${connectionId}`);
  if (!fqdns.data.some((f) => f.fqdn === options.sipHost)) {
    await call(z.unknown(), "POST", "/fqdns", {
      connection_id: connectionId,
      dns_record_type: "a",
      fqdn: options.sipHost,
      port: SIP_PORT,
    });
  }

  const numbers = await call(
    numberList,
    "GET",
    `/phone_numbers?filter[phone_number]=${encodeURIComponent(options.number)}`
  );
  const phoneNumber = numbers.data.find((n) => n.phone_number === options.number);
  if (!phoneNumber) {
    throw new Error(`${options.number} is not a phone number in this Telnyx account`);
  }
  if (phoneNumber.connection_id && phoneNumber.connection_id !== connectionId) {
    throw new Error(
      `${options.number} is assigned to Telnyx connection ${phoneNumber.connection_id}; unassign it there first`
    );
  }
  if (!phoneNumber.connection_id) {
    await call(z.unknown(), "PATCH", `/phone_numbers/${phoneNumber.id}`, {
      connection_id: connectionId,
    });
  }

  return { connectionId, phoneNumberId: phoneNumber.id };
}
