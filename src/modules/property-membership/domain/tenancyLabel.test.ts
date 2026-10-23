import { describe, expect, it } from 'vitest';
import { formatTenancyPeriod } from './tenancyLabel';

describe('rental period labels', () => {
  const startsAt = new Date('2026-10-20T17:00:00Z');
  const endsAt = new Date('2026-11-19T17:00:00Z');
  it('uses project calendar dates for an open rental', () => {
    expect(formatTenancyPeriod({ startsAt, endsAt: null })).toBe('2026-10-21 to present');
  });
  it('preserves planned dates for cancelled rentals', () => {
    expect(formatTenancyPeriod({ startsAt, endsAt, state: 'CANCELLED' })).toBe(
      '2026-10-21 to 2026-11-20 (cancelled)',
    );
  });
  it('does not imply an ongoing interval for an open-ended cancellation', () => {
    expect(formatTenancyPeriod({ startsAt, endsAt: null, state: 'CANCELLED' })).toBe(
      '2026-10-21 (cancelled)',
    );
  });
});
