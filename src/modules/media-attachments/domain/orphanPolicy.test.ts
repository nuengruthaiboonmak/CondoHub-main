import { describe, expect, it } from 'vitest';
import {
  ORPHAN_PENDING_GRACE_MS,
  ORPHAN_READY_GRACE_MS,
  isE2ESkipYoung,
  isOrphanSweepable,
} from './orphanPolicy';

const NOW = new Date('2026-10-15T06:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;

describe('UT-UP-02 orphan grace rules: stale intents at 30m, unattached READY at 24h', () => {
  it('freezes the grace constants', () => {
    expect(ORPHAN_PENDING_GRACE_MS).toBe(30 * MIN);
    expect(ORPHAN_READY_GRACE_MS).toBe(24 * HOUR);
  });

  it('sweeps PENDING and UPLOADED older than 30 minutes', () => {
    for (const state of ['PENDING', 'UPLOADED'] as const) {
      expect(
        isOrphanSweepable(
          { state, ownerEntityType: null, createdAt: new Date(NOW.getTime() - 31 * MIN), objectKey: 'chat/a.png' },
          NOW,
        ),
      ).toBe(true);
      expect(
        isOrphanSweepable(
          { state, ownerEntityType: null, createdAt: new Date(NOW.getTime() - 29 * MIN), objectKey: 'chat/a.png' },
          NOW,
        ),
      ).toBe(false);
    }
  });

  it('sweeps READY-unattached older than 24 hours but never young READY', () => {
    expect(
      isOrphanSweepable(
        { state: 'READY', ownerEntityType: null, createdAt: new Date(NOW.getTime() - 25 * HOUR), objectKey: 'chat/a.png' },
        NOW,
      ),
    ).toBe(true);
    expect(
      isOrphanSweepable(
        { state: 'READY', ownerEntityType: null, createdAt: new Date(NOW.getTime() - 23 * HOUR), objectKey: 'chat/a.png' },
        NOW,
      ),
    ).toBe(false);
  });

  it('never sweeps attached rows no matter how old', () => {
    expect(
      isOrphanSweepable(
        { state: 'READY', ownerEntityType: 'announcement', createdAt: new Date(NOW.getTime() - 30 * 24 * HOUR), objectKey: 'announcement/a.png' },
        NOW,
      ),
    ).toBe(false);
    expect(
      isOrphanSweepable(
        { state: 'PENDING', ownerEntityType: 'payment_submission', createdAt: new Date(NOW.getTime() - 30 * 24 * HOUR), objectKey: 'payment-slip/a.png' },
        NOW,
      ),
    ).toBe(false);
  });

  it('never re-sweeps terminal rows', () => {
    for (const state of ['REJECTED', 'ORPHANED'] as const) {
      expect(
        isOrphanSweepable(
          { state, ownerEntityType: null, createdAt: new Date(NOW.getTime() - 30 * 24 * HOUR), objectKey: 'chat/a.png' },
          NOW,
        ),
      ).toBe(false);
    }
  });
});

describe('UT-UP-02 X8 skip-young: e2e keys under 24h belong to teardown, not the sweeper', () => {
  it('skips young e2e keys and sweeps aged ones', () => {
    expect(isE2ESkipYoung('e2e/20261015-x/chat/a.png', new Date(NOW.getTime() - 1 * HOUR), NOW)).toBe(true);
    expect(isE2ESkipYoung('e2e/20261015-x/chat/a.png', new Date(NOW.getTime() - 25 * HOUR), NOW)).toBe(false);
  });

  it('never skips production keys', () => {
    expect(isE2ESkipYoung('chat/a.png', new Date(NOW.getTime() - 1 * MIN), NOW)).toBe(false);
    expect(isE2ESkipYoung('announcement/a.png', new Date(NOW.getTime() - 1 * HOUR), NOW)).toBe(false);
  });
});
