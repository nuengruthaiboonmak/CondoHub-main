import { describe, expect, it } from 'vitest';
import { readChargeEventRoomScope } from './chargeEventContext';

describe('one-time event room scope', () => {
  it('keeps legacy events without a scope compatible with project-wide issuance', () => {
    expect(readChargeEventRoomScope(null)).toBeNull();
    expect(readChargeEventRoomScope({ note: 'Roof repair' })).toBeNull();
  });
  it('preserves an explicitly chosen audience and removes duplicate room references', () => {
    const room = '70134c32-d418-411e-8644-b15ec0bfd3e5';
    expect(readChargeEventRoomScope({ roomIds: [room, room] })).toEqual([room]);
  });
  it('fails closed for malformed stored scopes instead of billing every room', () => {
    for (const roomIds of [null, [], ['not-a-room'], 'all'])
      expect(() => readChargeEventRoomScope({ roomIds })).toThrow();
  });
});
