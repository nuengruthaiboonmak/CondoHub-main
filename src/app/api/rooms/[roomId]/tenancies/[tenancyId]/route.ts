import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { isUuid } from '@/shared/utils/idempotency';
import { systemClock } from '@/shared/utils/clock';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  canActInRoom,
  cancelScheduledTenancy,
  endTenancyAt,
  listRoomTenancies,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { emitRoomAccessRevoked } from '@/modules/room-chat/application/index';
import { tenancyPatchBody } from '@/modules/property-membership/application/routeSchemas';

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    const tenancyId = params?.tenancyId;
    if (!roomId || !isUuid(roomId) || !tenancyId || !isUuid(tenancyId)) {
      throw new AppError('VALIDATION_ERROR', 'The room or tenancy id is invalid.');
    }
    const body = parseWithFieldErrors(tenancyPatchBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    if (!ctx.actor.isSystemAdmin) {
      const visible = await canActInRoom(
        ctx.actor.userId,
        roomId,
        'VIEW_ROOM',
        systemClock.now(),
      ).catch((error: unknown) => {
        if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
        throw error;
      });
      if (!visible?.allowed) throw new AppError('RESOURCE_NOT_FOUND');
    }
    const scoped = await listRoomTenancies(roomId);
    if (!scoped.some((tenancy) => tenancy.id === tenancyId)) {
      throw new AppError('RESOURCE_NOT_FOUND');
    }
    const ended =
      body.action === 'CANCEL'
        ? await cancelScheduledTenancy(ctx.actor, tenancyId, propertyCtx)
        : await endTenancyAt(
            ctx.actor,
            {
              tenancyId,
              endsAt: body.endsAt === undefined ? undefined : new Date(body.endsAt),
            },
            propertyCtx,
          );
    emitRoomAccessRevoked(roomId);
    return {
      id: ended.id,
      roomId: ended.roomId,
      endsAt: ended.endsAt === null ? null : ended.endsAt.toISOString(),
      state: ended.state,
    };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
