import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  canActInRoom,
  getCurrentOwners,
  getResidentIntervals,
  listRoomMemberships,
  listRoomTenancies,
} from '@/modules/property-membership/application/index';
import { findRoomById } from '@/modules/property-membership/infrastructure/structureRepository';
import { db } from '@/shared/db/client';

export const GET = withApi(
  async (_request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const now = systemClock.now();
    const verdict = await canActInRoom(ctx.actor.userId, roomId, 'VIEW_ROOM', now).catch(
      (error: unknown) => {
        if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
        throw error;
      },
    );
    if (verdict === null || (!verdict.allowed && !ctx.actor.isSystemAdmin)) {
      throw new AppError('RESOURCE_NOT_FOUND');
    }
    const room = await findRoomById(db, roomId);
    if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
    const [owners, intervals, memberships, tenancies] = await Promise.all([
      getCurrentOwners(roomId, now),
      getResidentIntervals(ctx.actor.userId, roomId),
      listRoomMemberships(roomId),
      listRoomTenancies(roomId),
    ]);
    return {
      id: room.id,
      floorId: room.floorId,
      buildingId: room.buildingId,
      roomCode: room.roomCode,
      name: room.name,
      areaSqm: room.areaSqm,
      status: room.status,
      owners: owners.map((owner) => ({
        userId: owner.userId,
        ownershipId: owner.ownershipId,
        startAt: owner.startAt.toISOString(),
        grantedBy: owner.grantedBy,
      })),
      myIntervals: intervals.map((interval) => ({
        start: interval.start.toISOString(),
        end: interval.end === null ? null : interval.end.toISOString(),
        kind: interval.kind,
      })),
      memberships: memberships.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        tenancyId: membership.tenancyId,
        memberRole: membership.memberRole,
        startAt: membership.startAt.toISOString(),
        endAt: membership.endAt === null ? null : membership.endAt.toISOString(),
      })),
      tenancies: tenancies.map((tenancy) => ({
        id: tenancy.id,
        startsAt: tenancy.startsAt.toISOString(),
        endsAt: tenancy.endsAt === null ? null : tenancy.endsAt.toISOString(),
        state: tenancy.state,
        managementMode: tenancy.managementMode,
      })),
    };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
