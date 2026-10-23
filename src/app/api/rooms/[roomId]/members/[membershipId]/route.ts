import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  endMembershipAt,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { memberPatchBody } from '@/modules/property-membership/application/routeSchemas';
import { emitRoomAccessRevoked } from '@/modules/room-chat/application/index';

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    const membershipId = params?.membershipId;
    if (roomId === undefined || roomId === '' || membershipId === undefined || membershipId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room or membership id is invalid.');
    }
    const body = parseWithFieldErrors(memberPatchBody, await request.json());
    if (body.action !== 'END') throw new AppError('VALIDATION_ERROR');
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    const ended = await endMembershipAt(ctx.actor, { roomId, membershipId }, propertyCtx);
    emitRoomAccessRevoked(roomId);
    return {
      id: ended.id,
      roomId: ended.roomId,
      userId: ended.userId,
      endAt: ended.endAt === null ? null : ended.endAt.toISOString(),
    };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
