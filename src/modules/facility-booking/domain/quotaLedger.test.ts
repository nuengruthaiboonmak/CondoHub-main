import { describe, expect, it } from 'vitest';
import { toPeriodKey } from '@/shared/utils/clock';
import {
  assertQuotaAllows,
  countQuotaUsed,
  groupSlotsByPeriod,
  slotPeriodKey,
  type QuotaLedgerCredit,
  type QuotaLedgerSlot,
} from './quotaLedger';

const TIME_ZONE = 'Asia/Bangkok';

function slot(id: string, startsAt: string, state: QuotaLedgerSlot['state'] = 'CONFIRMED'): QuotaLedgerSlot {
  return { id, startsAt: new Date(startsAt), state };
}

function credit(bookingSlotId: string, signedSlots = 1): QuotaLedgerCredit {
  return { bookingSlotId, signedSlots };
}

describe('UT-FB-02 daily, weekly, and monthly quota accounting', () => {
  it('counts confirmed slots per daily period in project time', () => {
    const first = new Date('2026-10-14T02:00:00.000Z');
    const key = toPeriodKey(first, 'DAILY', TIME_ZONE);
    const used = countQuotaUsed({
      slots: [slot('a', '2026-10-14T02:00:00.000Z'), slot('b', '2026-10-14T03:00:00.000Z')],
      credits: [],
      periodKey: key,
      kind: 'DAILY',
      timeZone: TIME_ZONE,
    });
    expect(key).toBe('2026-10-14:D');
    expect(used).toBe(2);
  });

  it('keeps a slot in one daily period across the UTC boundary', () => {
    const late = slot('late', '2026-10-13T16:30:00.000Z');
    expect(slotPeriodKey(late.startsAt, 'DAILY', TIME_ZONE)).toBe('2026-10-13:D');
    expect(slotPeriodKey(new Date('2026-10-13T17:30:00.000Z'), 'DAILY', TIME_ZONE)).toBe(
      '2026-10-14:D',
    );
  });

  it('groups multi-slot bookings by weekly and monthly keys', () => {
    const weekly = groupSlotsByPeriod(
      [new Date('2026-10-12T02:00:00.000Z'), new Date('2026-10-13T02:00:00.000Z')],
      'WEEKLY',
      TIME_ZONE,
    );
    expect([...weekly.entries()]).toEqual([['2026-W42:W', 2]]);
    const monthly = groupSlotsByPeriod(
      [new Date('2026-09-30T16:00:00.000Z'), new Date('2026-09-30T17:30:00.000Z')],
      'MONTHLY',
      TIME_ZONE,
    );
    expect([...monthly.entries()]).toEqual([
      ['2026-09:M', 1],
      ['2026-10:M', 1],
    ]);
  });

  it('uses the ISO week-numbering year at the year boundary', () => {
    expect(slotPeriodKey(new Date('2022-12-31T17:00:00.000Z'), 'WEEKLY', TIME_ZONE)).toBe(
      '2022-W52:W',
    );
    expect(slotPeriodKey(new Date('2023-01-01T17:00:00.000Z'), 'WEEKLY', TIME_ZONE)).toBe(
      '2023-W01:W',
    );
  });

  it('counts cancelled slots but subtracts one valid refund per slot', () => {
    const key = toPeriodKey(new Date('2026-10-14T02:00:00.000Z'), 'DAILY', TIME_ZONE);
    const used = countQuotaUsed({
      slots: [
        slot('confirmed', '2026-10-14T02:00:00.000Z', 'CONFIRMED'),
        slot('resident', '2026-10-14T03:00:00.000Z', 'RESIDENT_CANCELLED'),
        slot('admin', '2026-10-14T04:00:00.000Z', 'ADMIN_CANCELLED'),
      ],
      credits: [credit('admin')],
      periodKey: key,
      kind: 'DAILY',
      timeZone: TIME_ZONE,
    });
    expect(used).toBe(2);
  });

  it('ignores duplicate slot rows and duplicate credits for the same slot', () => {
    const key = toPeriodKey(new Date('2026-10-14T02:00:00.000Z'), 'DAILY', TIME_ZONE);
    const used = countQuotaUsed({
      slots: [
        slot('dup', '2026-10-14T02:00:00.000Z'),
        slot('dup', '2026-10-14T02:00:00.000Z'),
      ],
      credits: [credit('dup'), credit('dup')],
      periodKey: key,
      kind: 'DAILY',
      timeZone: TIME_ZONE,
    });
    expect(used).toBe(0);
  });

  it('fails closed instead of clamping a negative ledger', () => {
    const key = toPeriodKey(new Date('2026-10-14T02:00:00.000Z'), 'DAILY', TIME_ZONE);
    expect(() =>
      countQuotaUsed({
        slots: [slot('a', '2026-10-14T02:00:00.000Z')],
        credits: [credit('a', 2)],
        periodKey: key,
        kind: 'DAILY',
        timeZone: TIME_ZONE,
      }),
    ).toThrowError();
  });

  it('rejects a request that would exceed the effective limit', () => {
    const key = toPeriodKey(new Date('2026-10-14T02:00:00.000Z'), 'DAILY', TIME_ZONE);
    expect(() =>
      assertQuotaAllows({
        slots: [slot('a', '2026-10-14T02:00:00.000Z'), slot('b', '2026-10-14T03:00:00.000Z')],
        credits: [],
        periodKey: key,
        kind: 'DAILY',
        timeZone: TIME_ZONE,
        limit: 2,
        requestedSlots: 1,
      }),
    ).toThrowError();
    const used = assertQuotaAllows({
      slots: [slot('a', '2026-10-14T02:00:00.000Z')],
      credits: [],
      periodKey: key,
      kind: 'DAILY',
      timeZone: TIME_ZONE,
      limit: 2,
      requestedSlots: 1,
    });
    expect(used).toBe(1);
  });
});

describe('UT-FB-05 D08-A mid-cycle quota reduction', () => {
  const weekly = 'WEEKLY' as const;
  const key = '2026-W42:W';

  function usedOf(used: number): QuotaLedgerSlot[] {
    return Array.from({ length: used }, (_, index) =>
      slot(`s${index}`, '2026-10-12T02:00:00.000Z'),
    );
  }

  it('keeps existing bookings while blocking new requests over the reduced limit', () => {
    const base = {
      slots: usedOf(4),
      credits: [],
      periodKey: key,
      kind: weekly,
      timeZone: TIME_ZONE,
    };
    expect(countQuotaUsed(base)).toBe(4);
    expect(() => assertQuotaAllows({ ...base, limit: 2, requestedSlots: 1 })).toThrowError();
    expect(countQuotaUsed({ ...base, slots: [], credits: [] })).toBe(0);
  });

  it('lets valid refund credits reduce used without double counting', () => {
    const base = {
      slots: usedOf(4),
      credits: [credit('s0'), credit('s1'), credit('s1')],
      periodKey: key,
      kind: weekly,
      timeZone: TIME_ZONE,
    };
    expect(countQuotaUsed(base)).toBe(2);
    expect(() => assertQuotaAllows({ ...base, limit: 2, requestedSlots: 1 })).toThrowError();
    const afterThird = countQuotaUsed({
      ...base,
      credits: [...base.credits, credit('s2')],
    });
    expect(afterThird).toBe(1);
    expect(
      assertQuotaAllows({
        ...base,
        credits: [...base.credits, credit('s2')],
        limit: 2,
        requestedSlots: 1,
      }),
    ).toBe(1);
  });

  it('starts the next period at zero under the new limit', () => {
    const used = countQuotaUsed({
      slots: [slot('next', '2026-10-19T02:00:00.000Z')],
      credits: [],
      periodKey: '2026-W43:W',
      kind: weekly,
      timeZone: TIME_ZONE,
    });
    expect(used).toBe(1);
    expect(() =>
      assertQuotaAllows({
        slots: [slot('next', '2026-10-19T02:00:00.000Z')],
        credits: [],
        periodKey: '2026-W43:W',
        kind: weekly,
        timeZone: TIME_ZONE,
        limit: 2,
        requestedSlots: 2,
      }),
    ).toThrowError();
  });
});
