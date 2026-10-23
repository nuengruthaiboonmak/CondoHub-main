import { describe, expect, it } from 'vitest';
import { canCompleteFrom, isIntentExpired, isTerminalImageState } from './imageState';

const NOW = new Date('2026-10-15T06:00:00.000Z');

describe('UT-UP-02 intent state machine and the one-time complete guard', () => {
  it('only PENDING intents can complete', () => {
    expect(canCompleteFrom('PENDING')).toBe(true);
    expect(canCompleteFrom('UPLOADED')).toBe(false);
    expect(canCompleteFrom('READY')).toBe(false);
    expect(canCompleteFrom('REJECTED')).toBe(false);
    expect(canCompleteFrom('ORPHANED')).toBe(false);
  });

  it('REJECTED and ORPHANED are terminal', () => {
    expect(isTerminalImageState('REJECTED')).toBe(true);
    expect(isTerminalImageState('ORPHANED')).toBe(true);
    expect(isTerminalImageState('PENDING')).toBe(false);
    expect(isTerminalImageState('UPLOADED')).toBe(false);
    expect(isTerminalImageState('READY')).toBe(false);
  });

  it('an intent expires exactly at expiresAt and a null expiry never expires', () => {
    expect(isIntentExpired(new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(isIntentExpired(NOW, NOW)).toBe(true);
    expect(isIntentExpired(new Date(NOW.getTime() + 1), NOW)).toBe(false);
    expect(isIntentExpired(null, NOW)).toBe(false);
  });
});
