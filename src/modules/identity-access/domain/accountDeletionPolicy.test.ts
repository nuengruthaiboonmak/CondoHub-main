import { describe, expect, it } from 'vitest';
import { hasSolePrivateResponsibility } from './accountDeletionPolicy';

describe('account deletion responsibilities', () => {
  it('allows an account without unfinished responsibilities', () => {
    expect(hasSolePrivateResponsibility('a', [], ['a'])).toBe(false);
  });
  it('blocks the last manager even when other snapshot users are deleted', () => {
    expect(hasSolePrivateResponsibility('a', [['a', 'deleted']], ['a'])).toBe(true);
  });
  it('keeps work recoverable through another retained original manager', () => {
    expect(hasSolePrivateResponsibility('a', [['a', 'inactive']], ['a', 'inactive'])).toBe(false);
  });
  it('requires a remaining original manager for every relevant responsibility', () => {
    expect(hasSolePrivateResponsibility('a', [['a', 'b'], ['a'], ['c']], ['a', 'b'])).toBe(true);
    expect(hasSolePrivateResponsibility('a', [['b']], ['a'])).toBe(false);
  });
});
