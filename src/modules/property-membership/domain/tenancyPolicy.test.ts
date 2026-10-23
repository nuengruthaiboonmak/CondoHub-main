import { describe, expect, it } from 'vitest';
import { activeTenancyAt, canEndTenancy, canPlaceTenancy } from './tenancyPolicy';

const roomA = '11111111-0000-4000-8000-000000000001';

it('a cancelled rental grants no residency interval and permits a replacement on its planned dates', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-12-01T00:00:00Z');
  const existing = [{ roomId: roomA, start, end, state: 'CANCELLED' as const }];
  expect(activeTenancyAt(existing, roomA, start)).toBeNull();
  expect(canPlaceTenancy({ roomId: roomA, startsAt: start, endsAt: end, existing }).allowed).toBe(
    true,
  );
});

describe('UT-PR-03 tenancy intervals follow [start,end)', () => {
  it('finds the active tenancy at an instant with end-exclusive boundary', () => {
    const tenancies = [
      {
        roomId: roomA,
        state: 'ACTIVE' as const,
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    ];
    expect(activeTenancyAt(tenancies, roomA, new Date('2026-06-01T00:00:00.000Z'))).not.toBeNull();
    expect(activeTenancyAt(tenancies, roomA, new Date('2026-08-01T00:00:00.000Z'))).toBeNull();
    expect(activeTenancyAt(tenancies, roomA, new Date('2026-05-01T00:00:00.000Z'))).not.toBeNull();
  });

  it('ignores ended tenancies when resolving the active one', () => {
    const tenancies = [
      {
        roomId: roomA,
        state: 'ENDED' as const,
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    ];
    expect(activeTenancyAt(tenancies, roomA, new Date('2026-06-01T00:00:00.000Z'))).toBeNull();
  });

  it('rejects ending a tenancy at or before its start', () => {
    const tenancy = {
      roomId: roomA,
      state: 'ACTIVE' as const,
      start: new Date('2026-05-01T00:00:00.000Z'),
      end: null,
    };
    expect(canEndTenancy(tenancy, new Date('2026-05-01T00:00:00.000Z'))).toEqual({
      allowed: false,
      reason: 'OVERLAPS_ACTIVE_TENANCY',
    });
    expect(canEndTenancy(tenancy, new Date('2026-06-01T00:00:00.000Z'))).toEqual({
      allowed: true,
    });
  });
});

describe('UT-PR-07 PD-05 sequential turnover passes, overlap fails', () => {
  const existing = [
    {
      roomId: roomA,
      state: 'ACTIVE' as const,
      start: new Date('2026-05-01T00:00:00.000Z'),
      end: new Date('2026-08-01T00:00:00.000Z'),
    },
  ];

  it('allows a sequential tenancy starting exactly at the previous end', () => {
    expect(
      canPlaceTenancy({
        roomId: roomA,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: null,
        existing,
      }),
    ).toEqual({ allowed: true });
  });

  it('rejects an overlapping tenancy', () => {
    expect(
      canPlaceTenancy({
        roomId: roomA,
        startsAt: new Date('2026-07-31T23:59:59.999Z'),
        endsAt: null,
        existing,
      }),
    ).toEqual({ allowed: false, reason: 'OVERLAPS_ACTIVE_TENANCY' });
  });

  it('ignores ended tenancies for overlap decisions', () => {
    expect(
      canPlaceTenancy({
        roomId: roomA,
        startsAt: new Date('2026-06-01T00:00:00.000Z'),
        endsAt: null,
        existing: [{ ...existing[0]!, state: 'ENDED' }],
      }),
    ).toEqual({ allowed: true });
  });

  it('rejects overlap against an open-ended active tenancy', () => {
    expect(
      canPlaceTenancy({
        roomId: roomA,
        startsAt: new Date('2027-01-01T00:00:00.000Z'),
        endsAt: null,
        existing: [
          {
            roomId: roomA,
            state: 'ACTIVE',
            start: new Date('2026-05-01T00:00:00.000Z'),
            end: null,
          },
        ],
      }),
    ).toEqual({ allowed: false, reason: 'OVERLAPS_ACTIVE_TENANCY' });
  });
});
