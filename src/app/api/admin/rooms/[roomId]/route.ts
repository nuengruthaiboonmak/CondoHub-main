import 'server-only';
import { isUuid } from '@/shared/utils/idempotency';
import { deletePropertyResource } from '@/modules/property-membership/application/index';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  parseWithFieldErrors,
  updateRoomDetails,
} from '@/modules/property-membership/application/index';
import { roomPatchBody } from '@/modules/property-membership/application/routeSchemas';

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || !isUuid(roomId)) {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const body = parseWithFieldErrors(roomPatchBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    return updateRoomDetails(
      ctx.actor,
      roomId,
      { name: body.name, areaSqm: body.areaSqm, status: body.status },
      propertyCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const DELETE = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const id = (await route?.params)?.roomId;
    if (!id || !isUuid(id)) throw new AppError('VALIDATION_ERROR', 'The resource id is invalid.');
    return deletePropertyResource(
      ctx.actor,
      'room',
      id,
      createPropertyCtx({ requestId: ctx.requestId }),
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
