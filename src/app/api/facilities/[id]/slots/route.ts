import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  facilitySlotsQuery,
  getDayAvailability,
  parseWithFieldErrors,
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
    const query = parseWithFieldErrors(facilitySlotsQuery, {
      date: url.searchParams.get('date') ?? undefined,
      roomId: url.searchParams.get('roomId') ?? undefined,
    });
    return getDayAvailability(
      ctx.actor,
      id,
      { date: query.date, roomId: query.roomId },
      systemClock.now(),
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
