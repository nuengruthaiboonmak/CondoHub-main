import { describe, expect, it } from 'vitest';
import { canChangeOwnership, isOwnerAt } from './ownershipPolicy';

const roomA = '11111111-0000-4000-8000-000000000001';
const roomB = '11111111-0000-4000-8000-000000000002';
const ownerA = '22222222-0000-4000-8000-000000000001';
const tenant = '22222222-0000-4000-8000-000000000003';

describe('UT-PR-05 D05-1 grant is owner-only and immediate', () => {
  const at = new Date('2026-10-14T00:00:00.000Z');
  const ownerships = [
    { roomId: roomA, userId: ownerA, start: new Date('2026-01-01T00:00:00.000Z'), end: null },
  ];

  it('allows an active current owner to grant', () => {
    expect(isOwnerAt(ownerships, roomA, ownerA, at)).toBe(true);
    expect(
      canChangeOwnership({
        actorIsSystemAdmin: false,
        actorIsActiveOwner: true,
        kind: 'GRANT',
        targetIsSelf: false,
      }),
    ).toEqual({ allowed: true });
  });

  it('denies tenants, non-owners, and wrong-room owners', () => {
    expect(isOwnerAt(ownerships, roomA, tenant, at)).toBe(false);
    expect(isOwnerAt(ownerships, roomB, ownerA, at)).toBe(false);
    expect(
      canChangeOwnership({
        actorIsSystemAdmin: false,
        actorIsActiveOwner: false,
        kind: 'GRANT',
        targetIsSelf: false,
      }),
    ).toEqual({ allowed: false, reason: 'NOT_ROOM_OWNER' });
  });

  it('denies a grantor touching fellow owners via remove or transfer', () => {
    for (const kind of ['REMOVE', 'TRANSFER'] as const) {
      expect(
        canChangeOwnership({
          actorIsSystemAdmin: false,
          actorIsActiveOwner: true,
          kind,
          targetIsSelf: false,
        }),
      ).toEqual({ allowed: false, reason: 'CANNOT_ALTER_FELLOW_OWNER' });
    }
  });
});

describe('UT-PR-06 co-owner chains keep mutual protection', () => {
  it('lets admin grant while owners gain no remove power', () => {
    expect(
      canChangeOwnership({
        actorIsSystemAdmin: true,
        actorIsActiveOwner: false,
        kind: 'GRANT',
        targetIsSelf: false,
      }),
    ).toEqual({ allowed: true });
    expect(
      canChangeOwnership({
        actorIsSystemAdmin: false,
        actorIsActiveOwner: true,
        kind: 'REMOVE',
        targetIsSelf: false,
      }),
    ).toEqual({ allowed: false, reason: 'CANNOT_ALTER_FELLOW_OWNER' });
  });

  it('treats ended ownership as non-owner for new grants', () => {
    const at = new Date('2026-10-14T00:00:00.000Z');
    const ended = [
      {
        roomId: roomA,
        userId: ownerA,
        start: new Date('2026-01-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
    ];
    expect(isOwnerAt(ended, roomA, ownerA, at)).toBe(false);
  });
});
