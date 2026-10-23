import { describe, expect, it } from 'vitest';
import { cycleError, isCycleError } from './cycleError';

describe('cycle errors', () => {
  it('builds a room-scoped cycle error record', () => {
    expect(cycleError('room-1', '2026-10', 'The ownership history is missing.')).toEqual({
      roomId: 'room-1',
      cycle: '2026-10',
      reason: 'The ownership history is missing.',
    });
  });

  it('validates the cycle error shape', () => {
    expect(isCycleError(cycleError('room-1', '2026-10', 'reason'))).toBe(true);
    expect(isCycleError(null)).toBe(false);
    expect(isCycleError({ roomId: 'room-1' })).toBe(false);
  });
});
