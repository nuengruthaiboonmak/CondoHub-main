import { describe, it, expect } from 'vitest';
import { canViewRoom } from './roomVisibility';
describe('room management visibility', () => {
  it('keeps a currently owned room visible when its owner is not a resident', () =>
    expect(canViewRoom(false, true)).toBe(true));
  it('keeps current residents able to view their room', () =>
    expect(canViewRoom(true, false)).toBe(true));
  it('conceals rooms from former owners and ended residents', () =>
    expect(canViewRoom(false, false)).toBe(false));
});
