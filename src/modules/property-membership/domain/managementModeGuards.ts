export type RoomManagementMode = 'PROJECT_MANAGED' | 'PRIVATE_OWNER_MANAGED';

export type TenancyManagerKind = 'ADMIN' | 'OWNER' | 'NONE';

export type MaintenanceRoutingKind =
  | 'COMMON_AREA'
  | 'PRIVATE_OWNER'
  | 'PROJECT_MANAGED_PRIVATE';

export function tenancyManagerFor(mode: RoomManagementMode): TenancyManagerKind {
  return mode === 'PROJECT_MANAGED' ? 'ADMIN' : 'OWNER';
}

export interface TenancyActorContext {
  actorIsSystemAdmin: boolean;
  actorIsActiveOwner: boolean;
}

export function canManageTenancy(
  mode: RoomManagementMode,
  actor: TenancyActorContext,
): boolean {
  if (mode === 'PROJECT_MANAGED') return actor.actorIsSystemAdmin;
  return actor.actorIsSystemAdmin || actor.actorIsActiveOwner;
}

export interface TenantMaintenanceContext {
  actorIsReporter: boolean;
  actorIsSystemAdmin: boolean;
}

export function canAccessPrivateOwnedTicket(input: {
  routingKind: MaintenanceRoutingKind;
  actor: TenantMaintenanceContext;
  actorIsSnapshottedRecipient: boolean;
}): boolean {
  if (input.routingKind === 'COMMON_AREA') return true;
  if (input.routingKind === 'PROJECT_MANAGED_PRIVATE') {
    return input.actor.actorIsReporter || input.actor.actorIsSystemAdmin;
  }
  return input.actor.actorIsReporter || input.actorIsSnapshottedRecipient;
}

export function projectManagedTenantRoutesToAdmin(mode: RoomManagementMode): boolean {
  return mode === 'PROJECT_MANAGED';
}
