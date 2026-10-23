import { covers, subtractIntervals, type TimeInterval } from './intervals';
import type { OwnershipInterval } from './ownershipPolicy';

export type ResidentIntervalKind = 'TENANT' | 'OWNER_AS_RESIDENT';

export interface ResidentInterval extends TimeInterval {
  kind: ResidentIntervalKind;
}

export interface MembershipWindow extends TimeInterval {
  roomId: string;
  userId: string;
}

export interface TenancyWindow extends TimeInterval {
  roomId: string;
}

export function derivedOwnerResidentIntervals(
  ownerships: OwnershipInterval[],
  tenancies: TenancyWindow[],
  roomId: string,
  userId: string,
): ResidentInterval[] {
  const owned = ownerships.filter(
    (ownership) => ownership.roomId === roomId && ownership.userId === userId,
  );
  const roomTenancies: TimeInterval[] = tenancies
    .filter((tenancy) => tenancy.roomId === roomId)
    .map((tenancy) => ({ start: tenancy.start, end: tenancy.end }));
  const derived: ResidentInterval[] = [];
  for (const window of owned) {
    const segments = subtractIntervals(
      { start: window.start, end: window.end },
      roomTenancies,
    );
    for (const segment of segments) {
      derived.push({ start: segment.start, end: segment.end, kind: 'OWNER_AS_RESIDENT' });
    }
  }
  return derived.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function residentIntervalsFor(
  memberships: MembershipWindow[],
  ownerships: OwnershipInterval[],
  tenancies: TenancyWindow[],
  roomId: string,
  userId: string,
): ResidentInterval[] {
  const tenant: ResidentInterval[] = memberships
    .filter((membership) => membership.roomId === roomId && membership.userId === userId)
    .map((membership) => ({
      start: membership.start,
      end: membership.end,
      kind: 'TENANT' as const,
    }));
  const derived = derivedOwnerResidentIntervals(ownerships, tenancies, roomId, userId);
  return [...tenant, ...derived].sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function isActiveResident(
  memberships: MembershipWindow[],
  ownerships: OwnershipInterval[],
  tenancies: TenancyWindow[],
  roomId: string,
  userId: string,
  at: Date,
): boolean {
  return residentIntervalsFor(memberships, ownerships, tenancies, roomId, userId).some((interval) =>
    covers(interval, at),
  );
}

export function activeResidentRooms(
  memberships: MembershipWindow[],
  ownerships: OwnershipInterval[],
  tenancies: TenancyWindow[],
  userId: string,
  at: Date,
): string[] {
  const roomIds = new Set<string>();
  for (const membership of memberships) {
    if (membership.userId === userId) roomIds.add(membership.roomId);
  }
  for (const ownership of ownerships) {
    if (ownership.userId === userId) roomIds.add(ownership.roomId);
  }
  const result: string[] = [];
  for (const roomId of roomIds) {
    if (isActiveResident(memberships, ownerships, tenancies, roomId, userId, at)) {
      result.push(roomId);
    }
  }
  return result.sort();
}
