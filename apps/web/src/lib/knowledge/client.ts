import type { z } from "zod";
import type { createKnowledgeSource } from "./schemas";
import { knowledgeSourceList } from "./types";

const BASE = "/api/v1/knowledge";

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

export async function fetchKnowledgeSources() {
  const response = await send(BASE, {});
  return knowledgeSourceList.parse(await response.json()).sources;
}

export async function addKnowledgeSource(input: z.input<typeof createKnowledgeSource>) {
  await send(BASE, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function uploadKnowledgeFile(file: File) {
  const body = new FormData();
  body.set("file", file);
  await send(`${BASE}/files`, { body, method: "POST" });
}

export async function resyncKnowledgeSource(id: string) {
  await send(`${BASE}/${id}/sync`, { method: "POST" });
}

export async function deleteKnowledgeSource(id: string) {
  await send(`${BASE}/${id}`, { method: "DELETE" });
}
