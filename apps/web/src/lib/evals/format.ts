import {
  type EvalCallerAudio,
  type EvalRunStageLatency,
  formatStageLatency,
} from "@answerline/shared";

export function displayDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function displayCost(cost: string | null) {
  return cost === null ? "—" : `$${Number(cost).toFixed(6)}`;
}

export function displayLatency(latencyMs: number | null) {
  return latencyMs === null ? "—" : `${Math.round(latencyMs)} ms`;
}

export function displayWer(wer: number | null) {
  return wer === null ? "—" : `${(wer * 100).toFixed(1)}%`;
}

export function displayPassRate(passed: number | null, total: number | null) {
  if (passed === null || !total) {
    return "—";
  }
  return `${passed}/${total} (${Math.round((passed / total) * 100)}%)`;
}

export function displayStageLatency(summary: EvalRunStageLatency | null) {
  return formatStageLatency(summary) ?? "—";
}

export function displayCallerAudio(audio: EvalCallerAudio | null) {
  const parts = [audio?.profile === "phone" ? "Phone (8 kHz, G.711)" : "Clean"];
  if (audio?.noiseSnrDb !== undefined) {
    parts.push(`${audio.noiseSnrDb} dB SNR noise`);
  }
  parts.push(`seed ${audio?.seed ?? 0}`);
  return parts.join(", ");
}

export function displayCallerVoice(audio: EvalCallerAudio | null) {
  const model = audio?.tts ?? "Agent TTS";
  return audio?.voice ? `${model} (voice ${audio.voice})` : model;
}
