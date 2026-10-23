import { covers, overlaps, type TimeInterval } from './intervals';

export type TenancyState = 'ACTIVE' | 'ENDED' | 'CANCELLED';

export interface TenancyInterval extends TimeInterval {
  roomId: string;
  state: TenancyState;
}

export type TenancyConflictReason = 'OVERLAPS_ACTIVE_TENANCY';

export interface TenancyPlacementVerdict {
  allowed: boolean;
  reason?: TenancyConflictReason | undefined;
}

export function activeTenancyAt(
  tenancies: TenancyInterval[],
  roomId: string,
  at: Date,
): TenancyInterval | null {
  for (const tenancy of tenancies) {
    if (tenancy.roomId !== roomId) continue;
    if (tenancy.state !== 'ACTIVE') continue;
    if (covers(tenancy, at)) return tenancy;
  }
  return null;
}

export function hasActiveTenancyAt(
  tenancies: TenancyInterval[],
  roomId: string,
  at: Date,
): boolean {
  return activeTenancyAt(tenancies, roomId, at) !== null;
}

export function canPlaceTenancy(input: {
  roomId: string;
  startsAt: Date;
  endsAt: Date | null;
  existing: TenancyInterval[];
}): TenancyPlacementVerdict {
  const candidate: TimeInterval = { start: input.startsAt, end: input.endsAt };
  for (const tenancy of input.existing) {
    if (tenancy.roomId !== input.roomId) continue;
    if (tenancy.state !== 'ACTIVE') continue;
    if (overlaps(candidate, tenancy)) return { allowed: false, reason: 'OVERLAPS_ACTIVE_TENANCY' };
  }
  return { allowed: true };
}

export function canEndTenancy(tenancy: TenancyInterval, endedAt: Date): TenancyPlacementVerdict {
  if (tenancy.state !== 'ACTIVE') return { allowed: false, reason: 'OVERLAPS_ACTIVE_TENANCY' };
  if (endedAt.getTime() <= tenancy.start.getTime()) {
    return { allowed: false, reason: 'OVERLAPS_ACTIVE_TENANCY' };
  }
  return { allowed: true };
}
