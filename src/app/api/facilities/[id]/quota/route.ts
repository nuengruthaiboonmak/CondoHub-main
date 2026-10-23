import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  getRoomQuota,
  parseWithFieldErrors,
  roomQuotaQuery,
} from '@/modules/facility-booking/application/index';

export const GET = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new AppError('VALIDATION_ERROR', 'The facility id is invalid.');
    }
    const url = new URL(request.url);
    const query = parseWithFieldErrors(roomQuotaQuery, {
      roomId: url.searchParams.get('roomId') ?? undefined,
      date: url.searchParams.get('date') ?? undefined,
    });
    return getRoomQuota(
      ctx.actor,
      id,
      { roomId: query.roomId, date: query.date },
      systemClock.now(),
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
