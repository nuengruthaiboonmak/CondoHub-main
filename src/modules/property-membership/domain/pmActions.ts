export const PM_ACTIONS = [
  'BOOK_FACILITY',
  'VIEW_CHAT',
  'SEND_CHAT',
  'SUBMIT_MAINTENANCE',
  'PAY_INVOICE',
  'VIEW_ROOM',
  'MANAGE_MEMBERS',
  'GRANT_CO_OWNER',
  'TRANSFER_OWNERSHIP',
  'MANAGE_TENANCY',
  'VIEW_FINANCE',
  'ADMINISTER_ROOM',
] as const;

export type PmAction = (typeof PM_ACTIONS)[number];

export function isPmAction(value: unknown): value is PmAction {
  return typeof value === 'string' && (PM_ACTIONS as readonly string[]).includes(value);
}

export type RoomActDenyReason =
  | 'NO_CURRENT_ACCESS'
  | 'MEMBERSHIP_GAP'
  | 'NOT_ROOM_OWNER'
  | 'ADMIN_ONLY'
  | 'MANAGER_REQUIRED';

export interface RoomActVerdict {
  allowed: boolean;
  reason?: RoomActDenyReason | undefined;
}
