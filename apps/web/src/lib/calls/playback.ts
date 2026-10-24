export function turnOffsetSeconds(turnStartedAt: Date, recordingStartedAt: Date | null) {
  if (!recordingStartedAt) {
    return null;
  }
  const offset = (turnStartedAt.getTime() - recordingStartedAt.getTime()) / 1000;
  return offset < 0 ? null : offset;
}

export function activeTurnIndex(offsets: ReadonlyArray<number | null>, currentTime: number) {
  let active = -1;
  for (const [index, offset] of offsets.entries()) {
    if (offset !== null && offset <= currentTime) {
      active = index;
    }
  }
  return active;
}

export function formatOffset(totalSeconds: number) {
  const seconds = Math.floor(Math.max(0, totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
