export interface CycleError {
  roomId: string;
  cycle: string;
  reason: string;
}

export function cycleError(roomId: string, cycle: string, reason: string): CycleError {
  return { roomId, cycle, reason };
}

export function isCycleError(value: unknown): value is CycleError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.roomId === 'string' &&
    typeof record.cycle === 'string' &&
    typeof record.reason === 'string'
  );
}
