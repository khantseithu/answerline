import { phoneNumberList } from "./types";

const BASE = "/api/v1/phone-numbers";

async function send(input: string, init: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return response;
}

const numberUrl = (number: string) => `${BASE}/${encodeURIComponent(number)}`;
const json = { "Content-Type": "application/json" };

export async function fetchPhoneNumbers() {
  const response = await send(BASE, {});
  return phoneNumberList.parse(await response.json());
}

export async function addPhoneNumber(input: { agent: string; number: string }) {
  await send(BASE, { body: JSON.stringify(input), headers: json, method: "POST" });
}

export async function assignPhoneNumber(number: string, agent: string) {
  await send(numberUrl(number), {
    body: JSON.stringify({ agent }),
    headers: json,
    method: "PATCH",
  });
}

export async function removePhoneNumber(number: string) {
  await send(numberUrl(number), { method: "DELETE" });
}
