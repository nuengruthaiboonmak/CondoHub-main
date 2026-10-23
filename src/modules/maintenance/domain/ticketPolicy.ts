import type {
  MaintenanceRoutingKind,
  MaintenanceStatus,
} from '../infrastructure/schema';
import { isReporterCancellable, isTerminalStatus } from './stateMachine';

export type TicketAction =
  | 'VIEW'
  | 'COMMENT'
  | 'VIEW_IMAGE'
  | 'TRANSITION_HANDLER'
  | 'TRANSITION_TO';

export interface TicketActorGrants {
  actorIsSystemAdmin: boolean;
  actorSuspended: boolean;
  actorMustChangePassword: boolean;
  actorIsReporter: boolean;
  actorInRecipientSnapshot: boolean;
}

export interface TicketResourceState {
  routingKind: MaintenanceRoutingKind;
  status: MaintenanceStatus;
}

export type TicketAccessVerdict =
  | { allowed: true }
  | { allowed: false; httpStatus: 403 | 404 };

export function evaluateTicketAccess(
  grants: TicketActorGrants,
  resource: TicketResourceState,
  action: TicketAction,
  target?: { toStatus: MaintenanceStatus },
): TicketAccessVerdict {
  if (grants.actorSuspended || grants.actorMustChangePassword) {
    return { allowed: false, httpStatus: 403 };
  }
  if (resource.routingKind === 'PRIVATE_OWNER') {
    return evaluatePrivateOwnerAccess(grants, resource, action, target);
  }
  return evaluateAdminRoutedAccess(grants, resource, action, target);
}

function evaluatePrivateOwnerAccess(
  grants: TicketActorGrants,
  resource: TicketResourceState,
  action: TicketAction,
  target: { toStatus: MaintenanceStatus } | undefined,
): TicketAccessVerdict {
  if (grants.actorIsSystemAdmin) return { allowed: false, httpStatus: 404 };
  const entitled = grants.actorIsReporter || grants.actorInRecipientSnapshot;
  if (!entitled) return { allowed: false, httpStatus: 404 };
  return evaluateOpenOrTerminal(grants, resource, action, target, 404);
}

function evaluateAdminRoutedAccess(
  grants: TicketActorGrants,
  resource: TicketResourceState,
  action: TicketAction,
  target: { toStatus: MaintenanceStatus } | undefined,
): TicketAccessVerdict {
  if (grants.actorIsSystemAdmin) {
    if (isTerminalStatus(resource.status)) {
      return action === 'VIEW' || action === 'VIEW_IMAGE'
        ? { allowed: true }
        : { allowed: false, httpStatus: 403 };
    }
    return { allowed: true };
  }
  if (!grants.actorIsReporter) return { allowed: false, httpStatus: 403 };
  return evaluateOpenOrTerminal(grants, resource, action, target, 403);
}

function evaluateOpenOrTerminal(
  grants: TicketActorGrants,
  resource: TicketResourceState,
  action: TicketAction,
  target: { toStatus: MaintenanceStatus } | undefined,
  deniedStatus: 403 | 404,
): TicketAccessVerdict {
  if (isTerminalStatus(resource.status)) {
    return action === 'VIEW' || action === 'VIEW_IMAGE'
      ? { allowed: true }
      : { allowed: false, httpStatus: deniedStatus };
  }
  if (action === 'VIEW' || action === 'VIEW_IMAGE' || action === 'COMMENT') {
    return { allowed: true };
  }
  if (action === 'TRANSITION_HANDLER') {
    if (grants.actorIsSystemAdmin) return { allowed: true };
    return grants.actorInRecipientSnapshot
      ? { allowed: true }
      : { allowed: false, httpStatus: deniedStatus };
  }
  if (target === undefined) return { allowed: false, httpStatus: deniedStatus };
  if (grants.actorIsSystemAdmin) return { allowed: true };
  if (grants.actorInRecipientSnapshot) return { allowed: true };
  if (
    grants.actorIsReporter &&
    isReporterCancellable(resource.status, target.toStatus)
  ) {
    return { allowed: true };
  }
  return { allowed: false, httpStatus: deniedStatus };
}

export function allowedRoutingKinds(actorIsSystemAdmin: boolean): MaintenanceRoutingKind[] {
  return actorIsSystemAdmin
    ? ['COMMON_AREA', 'PROJECT_MANAGED_PRIVATE']
    : ['COMMON_AREA', 'PRIVATE_OWNER', 'PROJECT_MANAGED_PRIVATE'];
}
