import type { Actor } from '@/shared/auth/actor';

export type RoomManagementMode = 'PROJECT_MANAGED' | 'PRIVATE_OWNER_MANAGED';

export type ProvisionTargetRole = 'TENANT' | 'CO_OWNER';

export interface RoomEntitlement {
  roomId: string;
  managementMode: RoomManagementMode;
  isCurrentOwner: boolean;
  isTopTenantManager: boolean;
}

export type ProvisionDenyReason =
  | 'NOT_ROOM_SCOPED'
  | 'OWNER_REQUIRED'
  | 'MANAGER_REQUIRED'
  | 'CROSS_ROOM'
  | 'ROLE_ESCALATION';

export interface ProvisioningVerdict {
  allowed: boolean;
  reason?: ProvisionDenyReason;
}

export function canProvisionInRoom(
  actor: Actor,
  entitlement: RoomEntitlement,
  targetRole: ProvisionTargetRole,
): ProvisioningVerdict {
  if (actor.isSystemAdmin && entitlement.managementMode === 'PROJECT_MANAGED') {
    if (targetRole === 'CO_OWNER') return { allowed: false, reason: 'ROLE_ESCALATION' };
    return { allowed: true };
  }
  if (targetRole === 'CO_OWNER') {
    if (!entitlement.isCurrentOwner) return { allowed: false, reason: 'OWNER_REQUIRED' };
    return { allowed: true };
  }
  if (entitlement.managementMode === 'PRIVATE_OWNER_MANAGED' && entitlement.isCurrentOwner) {
    return { allowed: true };
  }
  if (entitlement.isTopTenantManager) return { allowed: true };
  if (entitlement.managementMode === 'PROJECT_MANAGED') {
    return { allowed: false, reason: 'MANAGER_REQUIRED' };
  }
  return { allowed: false, reason: 'NOT_ROOM_SCOPED' };
}

export function canProvisionSystemWide(actor: Actor): boolean {
  return actor.isSystemAdmin;
}
