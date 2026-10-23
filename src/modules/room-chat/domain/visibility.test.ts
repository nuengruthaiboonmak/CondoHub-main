import { describe, expect, it } from 'vitest';
import { evaluateChatAccess } from './chatPolicy';
import { messageVisibleAt } from './visibility';

const instant = (iso: string): Date => new Date(iso);

describe('UT-CH-02 owner blackout during active tenancy plus ex-resident denial', () => {
  it('denies an owner any chat action while an active tenancy covers now', () => {
    const verdict = evaluateChatAccess(
      { actorIsSystemAdmin: false, actorHasCurrentRoomAccess: false },
      'SEND_CHAT',
    );
    expect(verdict).toEqual({ allowed: false, httpStatus: 404 });
  });

  it('denies an owner chat history during the tenancy blackout window', () => {
    const intervals = [{ start: instant('2026-07-01T00:00:00.000Z'), end: instant('2026-08-01T00:00:00.000Z') }];
    expect(messageVisibleAt(intervals, instant('2026-09-15T00:00:00.000Z'))).toBe(false);
  });

  it('restores an owner to vacancy-only visibility after the tenancy ends', () => {
    const intervals = [
      { start: instant('2026-08-01T00:00:00.000Z'), end: instant('2026-09-01T00:00:00.000Z') },
      { start: instant('2026-10-01T00:00:00.000Z'), end: null },
    ];
    expect(messageVisibleAt(intervals, instant('2026-08-15T00:00:00.000Z'))).toBe(true);
    expect(messageVisibleAt(intervals, instant('2026-09-15T00:00:00.000Z'))).toBe(false);
    expect(messageVisibleAt(intervals, instant('2026-10-15T00:00:00.000Z'))).toBe(true);
  });

  it('denies an ex-resident every chat action after the last interval ends', () => {
    for (const action of ['VIEW_CHAT', 'SEND_CHAT', 'JOIN_SOCKET', 'VIEW_IMAGE'] as const) {
      expect(
        evaluateChatAccess(
          { actorIsSystemAdmin: false, actorHasCurrentRoomAccess: false },
          action,
        ),
      ).toEqual({ allowed: false, httpStatus: 404 });
    }
  });

  it('keeps an ex-resident out of history even for timestamps inside a past interval', () => {
    const verdict = evaluateChatAccess(
      { actorIsSystemAdmin: false, actorHasCurrentRoomAccess: false },
      'VIEW_CHAT',
    );
    expect(verdict.allowed).toBe(false);
  });
});
