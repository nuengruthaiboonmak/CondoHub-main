import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  disableRoom,
} from '@/modules/property-membership/application/index';

export const POST = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    return disableRoom(ctx.actor, roomId, propertyCtx);
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
