import { covers, type TimeInterval } from './intervals';

export interface OwnershipInterval extends TimeInterval {
  roomId: string;
  userId: string;
}

export type OwnershipChangeKind = 'GRANT' | 'REMOVE' | 'TRANSFER' | 'CORRECT';

export type OwnershipDenyReason = 'NOT_ROOM_OWNER' | 'CANNOT_ALTER_FELLOW_OWNER' | 'ADMIN_ONLY';

export interface OwnershipVerdict {
  allowed: boolean;
  reason?: OwnershipDenyReason | undefined;
}

export function isOwnerAt(
  ownerships: OwnershipInterval[],
  roomId: string,
  userId: string,
  at: Date,
): boolean {
  return ownerships.some(
    (ownership) =>
      ownership.roomId === roomId && ownership.userId === userId && covers(ownership, at),
  );
}

export function ownersAt(ownerships: OwnershipInterval[], roomId: string, at: Date): string[] {
  return ownerships
    .filter((ownership) => ownership.roomId === roomId && covers(ownership, at))
    .map((ownership) => ownership.userId);
}

export function hasActiveOwnership(
  ownerships: OwnershipInterval[],
  roomId: string,
  userId: string,
  at: Date,
): boolean {
  return isOwnerAt(ownerships, roomId, userId, at);
}

export function canChangeOwnership(input: {
  actorIsSystemAdmin: boolean;
  actorIsActiveOwner: boolean;
  kind: OwnershipChangeKind;
  targetIsSelf: boolean;
}): OwnershipVerdict {
  if (input.actorIsSystemAdmin) return { allowed: true };
  if (input.kind === 'GRANT') {
    if (!input.actorIsActiveOwner) return { allowed: false, reason: 'NOT_ROOM_OWNER' };
    return { allowed: true };
  }
  if (input.kind === 'REMOVE' || input.kind === 'TRANSFER' || input.kind === 'CORRECT') {
    if (input.targetIsSelf) return { allowed: false, reason: 'ADMIN_ONLY' };
    return { allowed: false, reason: 'CANNOT_ALTER_FELLOW_OWNER' };
  }
  return { allowed: false, reason: 'ADMIN_ONLY' };
}
