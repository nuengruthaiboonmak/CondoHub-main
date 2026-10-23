import { describe, expect, it } from 'vitest';
import { canChangeOwnership, isOwnerAt, ownersAt } from './ownershipPolicy';

const roomA = '11111111-0000-4000-8000-000000000001';
const roomB = '11111111-0000-4000-8000-000000000002';
const ownerA = '22222222-0000-4000-8000-000000000001';
const ownerB = '22222222-0000-4000-8000-000000000002';
const tenant = '22222222-0000-4000-8000-000000000003';

describe('UT-PR-01 co-owner cannot remove or demote another owner', () => {
  const at = new Date('2026-10-14T00:00:00.000Z');
  const ownerships = [
    { roomId: roomA, userId: ownerA, start: new Date('2026-01-01T00:00:00.000Z'), end: null },
    { roomId: roomA, userId: ownerB, start: new Date('2026-02-01T00:00:00.000Z'), end: null },
  ];

  it('denies a co-owner removing a fellow owner', () => {
    const verdict = canChangeOwnership({
      actorIsSystemAdmin: false,
      actorIsActiveOwner: true,
      kind: 'REMOVE',
      targetIsSelf: false,
    });
    expect(verdict).toEqual({ allowed: false, reason: 'CANNOT_ALTER_FELLOW_OWNER' });
  });

  it('denies a co-owner transferring a fellow owner', () => {
    const verdict = canChangeOwnership({
      actorIsSystemAdmin: false,
      actorIsActiveOwner: true,
      kind: 'TRANSFER',
      targetIsSelf: false,
    });
    expect(verdict).toEqual({ allowed: false, reason: 'CANNOT_ALTER_FELLOW_OWNER' });
  });

  it('denies a co-owner correcting their own interval without admin', () => {
    const verdict = canChangeOwnership({
      actorIsSystemAdmin: false,
      actorIsActiveOwner: true,
      kind: 'CORRECT',
      targetIsSelf: true,
    });
    expect(verdict).toEqual({ allowed: false, reason: 'ADMIN_ONLY' });
  });

  it('allows an admin to remove, transfer, and correct', () => {
    for (const kind of ['REMOVE', 'TRANSFER', 'CORRECT'] as const) {
      expect(
        canChangeOwnership({
          actorIsSystemAdmin: true,
          actorIsActiveOwner: false,
          kind,
          targetIsSelf: false,
        }),
      ).toEqual({ allowed: true });
    }
  });

  it('resolves active owners with [start,end) boundary semantics', () => {
    expect(isOwnerAt(ownerships, roomA, ownerA, at)).toBe(true);
    expect(isOwnerAt(ownerships, roomA, tenant, at)).toBe(false);
    expect(isOwnerAt(ownerships, roomB, ownerA, at)).toBe(false);
    expect(ownersAt(ownerships, roomA, at).sort()).toEqual([ownerA, ownerB].sort());
    const edge = new Date('2026-02-01T00:00:00.000Z');
    expect(isOwnerAt(ownerships, roomA, ownerB, edge)).toBe(true);
    expect(
      isOwnerAt(ownerships, roomA, ownerB, new Date(edge.getTime() - 1)),
    ).toBe(false);
  });
});
