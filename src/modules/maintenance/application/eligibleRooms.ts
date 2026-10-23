import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { AppError } from '@/shared/utils/errors';
import { getEligibleMaintenanceRooms } from '@/modules/property-membership/application/index';
import type { MaintenanceRoutingKind } from '../infrastructure/schema';

export interface EligibleRoomsDto {
  roomIds: string[];
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export async function listEligibleRooms(
  actor: Actor,
  routingKind: MaintenanceRoutingKind,
  at: Date,
): Promise<EligibleRoomsDto> {
  assertActive(actor);
  const roomIds = await getEligibleMaintenanceRooms(actor.userId, routingKind, at);
  return { roomIds };
}
