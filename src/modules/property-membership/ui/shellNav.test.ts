import { describe, expect, it } from 'vitest';
import { matchNavHref } from './shellNav';

describe('room chat navigation', () => {
  it('keeps Rooms active for both resident and admin room conversations', () => {
    expect(matchNavHref('/rooms/room-id/chat', '/rooms')).toBe(true);
    expect(matchNavHref('/admin/rooms/room-id/chat', '/rooms')).toBe(true);
  });

  it('does not match similarly named administration routes', () => {
    expect(matchNavHref('/admin/rooms-archive', '/rooms')).toBe(false);
    expect(matchNavHref('/admin/buildings/room-id', '/rooms')).toBe(false);
    expect(matchNavHref('/admin/rooms/room-id/chat', '/admin/buildings')).toBe(false);
  });
});
