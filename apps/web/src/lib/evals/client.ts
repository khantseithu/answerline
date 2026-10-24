import type { EvalRunCreate } from "@answerline/shared";
import { z } from "zod";
import { evalRunList, evalRunView } from "./types";

const BASE = "/api/v1/evals";

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

export async function fetchEvalRuns() {
  const response = await send(BASE, {});
  return evalRunList.parse(await response.json()).runs;
}

export async function startEvalRun(input: EvalRunCreate) {
  const response = await send(BASE, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return z.object({ run: evalRunView }).parse(await response.json()).run;
}
