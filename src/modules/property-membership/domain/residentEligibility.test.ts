import { describe, expect, it } from 'vitest';
import {
  activeResidentRooms,
  derivedOwnerResidentIntervals,
  isActiveResident,
  residentIntervalsFor,
} from './residentEligibility';

const roomA = '11111111-0000-4000-8000-000000000001';
const roomB = '11111111-0000-4000-8000-000000000002';
const owner = '22222222-0000-4000-8000-000000000001';
const tenant = '22222222-0000-4000-8000-000000000002';

const owned = [
  { roomId: roomA, userId: owner, start: new Date('2026-01-01T00:00:00.000Z'), end: null },
  { roomId: roomB, userId: owner, start: new Date('2026-01-01T00:00:00.000Z'), end: null },
];

describe('UT-PR-02 owner-as-resident only in vacancy', () => {
  it('grants derived residency during vacancy', () => {
    const intervals = derivedOwnerResidentIntervals(owned, [], roomA, owner);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.kind).toBe('OWNER_AS_RESIDENT');
    expect(
      isActiveResident([], owned, [], roomA, owner, new Date('2026-06-01T00:00:00.000Z')),
    ).toBe(true);
  });

  it('removes derived residency while a tenancy is active', () => {
    const tenancies = [
      {
        roomId: roomA,
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    ];
    const intervals = derivedOwnerResidentIntervals(owned, tenancies, roomA, owner);
    expect(intervals).toHaveLength(2);
    expect(
      isActiveResident([], owned, tenancies, roomA, owner, new Date('2026-06-01T00:00:00.000Z')),
    ).toBe(false);
    expect(
      isActiveResident([], owned, tenancies, roomA, owner, new Date('2026-08-01T00:00:00.000Z')),
    ).toBe(true);
    expect(
      isActiveResident([], owned, tenancies, roomA, owner, new Date('2026-04-30T23:59:59.999Z')),
    ).toBe(true);
  });

  it('supports residents across multiple rooms', () => {
    const memberships = [
      {
        roomId: roomB,
        userId: tenant,
        start: new Date('2026-01-01T00:00:00.000Z'),
        end: null,
      },
    ];
    const at = new Date('2026-06-01T00:00:00.000Z');
    expect(activeResidentRooms(memberships, owned, [], owner, at).sort()).toEqual(
      [roomA, roomB].sort(),
    );
    expect(activeResidentRooms(memberships, owned, [], tenant, at)).toEqual([roomB]);
    const intervals = residentIntervalsFor(memberships, owned, [], roomB, tenant);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.kind).toBe('TENANT');
  });
});
