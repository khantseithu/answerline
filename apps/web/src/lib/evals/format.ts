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
