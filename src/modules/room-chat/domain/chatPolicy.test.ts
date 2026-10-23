import { describe, expect, it } from 'vitest';
import { evaluateChatAccess } from './chatPolicy';
import { messageVisibleAt, visibleSlices } from './visibility';

const day = (dayNumber: number): Date => new Date(Date.UTC(2026, 9, dayNumber));

describe('UT-CH-01 current access plus historic eligible intervals including rejoin gap', () => {
  it('grants view when the actor holds current room access', () => {
    const verdict = evaluateChatAccess(
      { actorIsSystemAdmin: false, actorHasCurrentRoomAccess: true },
      'VIEW_CHAT',
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it('denies view with concealment when the actor has no current access', () => {
    const verdict = evaluateChatAccess(
      { actorIsSystemAdmin: false, actorHasCurrentRoomAccess: false },
      'VIEW_CHAT',
    );
    expect(verdict).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('grants an admin chat access without any room interval', () => {
    const verdict = evaluateChatAccess(
      { actorIsSystemAdmin: true, actorHasCurrentRoomAccess: false },
      'VIEW_CHAT',
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it('shows messages inside each eligible segment of a rejoined resident', () => {
    const intervals = [
      { start: day(1), end: day(10) },
      { start: day(20), end: null },
    ];
    expect(messageVisibleAt(intervals, day(5))).toBe(true);
    expect(messageVisibleAt(intervals, day(25))).toBe(true);
  });

  it('hides messages inside the gap even after the resident rejoins', () => {
    const intervals = [
      { start: day(1), end: day(10) },
      { start: day(20), end: null },
    ];
    expect(messageVisibleAt(intervals, day(15))).toBe(false);
  });

  it('applies half-open interval edges at segment boundaries', () => {
    const intervals = [{ start: day(1), end: day(10) }];
    expect(messageVisibleAt(intervals, day(1))).toBe(true);
    expect(messageVisibleAt(intervals, day(10))).toBe(false);
  });

  it('denies send with concealment when the actor has no current access', () => {
    const verdict = evaluateChatAccess(
      { actorIsSystemAdmin: false, actorHasCurrentRoomAccess: false },
      'SEND_CHAT',
    );
    expect(verdict).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('clips eligible slices to the requested window without bridging the gap', () => {
    const slices = visibleSlices({
      intervals: [
        { start: day(1), end: day(10) },
        { start: day(20), end: null },
      ],
      rangeStart: day(5),
      rangeEnd: day(25),
    });
    expect(slices).toEqual([
      { start: day(5), end: day(10) },
      { start: day(20), end: day(25) },
    ]);
  });
});
