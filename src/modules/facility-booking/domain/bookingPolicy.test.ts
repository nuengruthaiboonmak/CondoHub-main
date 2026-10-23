import { describe, expect, it } from 'vitest';
import type { Actor } from '@/shared/auth/actor';
import {
  assertResidentCancelAllowed,
  canBookFacility,
  nextCancelState,
  overlaps,
  slotFitsSchedule,
} from './bookingPolicy';
import type { FacilitySchedule } from './schedule';

const TIME_ZONE = 'Asia/Bangkok';

function actor(overrides?: Partial<Actor>): Actor {
  return {
    userId: 'user-1',
    isSystemAdmin: false,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    ...overrides,
  };
}

function weekdaySchedule(): FacilitySchedule {
  const open = [{ start: '09:00', end: '12:00' }];
  const closed = { open: [], breaks: [] };
  const mid = { open, breaks: [{ start: '10:00', end: '11:00' }] };
  return {
    days: {
      '0': closed,
      '1': closed,
      '2': closed,
      '3': mid,
      '4': closed,
      '5': closed,
      '6': closed,
    },
    holidays: [],
  };
}

describe('UT-FB-03 resident and admin cancel rules', () => {
  it('allows active residents and admins while denying outsiders and gated accounts', () => {
    expect(canBookFacility(actor(), true)).toEqual({ allowed: true });
    expect(canBookFacility(actor({ isSystemAdmin: true }), false)).toEqual({ allowed: true });
    expect(canBookFacility(actor(), false)).toEqual({ allowed: false, reason: 'NOT_RESIDENT' });
    expect(canBookFacility(actor({ accountStatus: 'SUSPENDED' }), true)).toEqual({
      allowed: false,
      reason: 'ACCOUNT_SUSPENDED',
    });
    expect(canBookFacility(actor({ mustChangePassword: true }), true)).toEqual({
      allowed: false,
      reason: 'FIRST_LOGIN_REQUIRED',
    });
  });

  it('lets residents cancel only future slots', () => {
    expect(() =>
      assertResidentCancelAllowed(
        new Date('2026-10-14T03:00:00.000Z'),
        new Date('2026-10-14T02:00:00.000Z'),
      ),
    ).not.toThrow();
    expect(() =>
      assertResidentCancelAllowed(
        new Date('2026-10-14T02:00:00.000Z'),
        new Date('2026-10-14T02:00:00.000Z'),
      ),
    ).toThrowError();
    expect(() =>
      assertResidentCancelAllowed(
        new Date('2026-10-14T01:00:00.000Z'),
        new Date('2026-10-14T02:00:00.000Z'),
      ),
    ).toThrowError();
  });

  it('records the cancel actor state without touching sibling slots', () => {
    expect(nextCancelState(false)).toBe('RESIDENT_CANCELLED');
    expect(nextCancelState(true)).toBe('ADMIN_CANCELLED');
  });
});

describe('UT-FB-03 slot fit and overlap checks', () => {
  it('accepts inside-open slots and rejects breaks, closures, and cross-day spans', () => {
    const schedule = weekdaySchedule();
    expect(
      slotFitsSchedule({
        schedule,
        startsAt: new Date('2026-10-14T02:00:00.000Z'),
        endsAt: new Date('2026-10-14T03:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe(true);
    expect(
      slotFitsSchedule({
        schedule,
        startsAt: new Date('2026-10-14T02:30:00.000Z'),
        endsAt: new Date('2026-10-14T04:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe(false);
    expect(
      slotFitsSchedule({
        schedule,
        startsAt: new Date('2026-10-14T16:30:00.000Z'),
        endsAt: new Date('2026-10-14T17:30:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe(false);
    expect(
      slotFitsSchedule({
        schedule,
        startsAt: new Date('2026-10-14T01:00:00.000Z'),
        endsAt: new Date('2026-10-14T02:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe(false);
  });

  it('accepts an opening that ends exactly at local midnight', () => {
    const schedule = weekdaySchedule();
    schedule.days['3'] = { open: [{ start: '23:00', end: '24:00' }], breaks: [] };
    expect(
      slotFitsSchedule({
        schedule,
        startsAt: new Date('2026-10-14T16:00:00.000Z'),
        endsAt: new Date('2026-10-14T17:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe(true);
  });

  it('detects half-open overlap only', () => {
    const left = { startsAt: new Date('2026-10-14T02:00:00.000Z'), endsAt: new Date('2026-10-14T03:00:00.000Z') };
    const touching = { startsAt: new Date('2026-10-14T03:00:00.000Z'), endsAt: new Date('2026-10-14T04:00:00.000Z') };
    const overlapping = { startsAt: new Date('2026-10-14T02:30:00.000Z'), endsAt: new Date('2026-10-14T03:30:00.000Z') };
    expect(overlaps(left, touching)).toBe(false);
    expect(overlaps(left, overlapping)).toBe(true);
  });
});
