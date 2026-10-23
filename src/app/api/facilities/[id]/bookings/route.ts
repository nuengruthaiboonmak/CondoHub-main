import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey } from '@/shared/utils/idempotency';
import {
  bookingCreateBody,
  createBooking,
  createBookingCtx,
  parseWithFieldErrors,
} from '@/modules/facility-booking/application/index';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new AppError('VALIDATION_ERROR', 'The facility id is invalid.');
    }
    const body = parseWithFieldErrors(bookingCreateBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const bookingCtx = createBookingCtx({ requestId: ctx.requestId });
    return createBooking(
      ctx.actor,
      {
        facilityId: id,
        roomId: body.roomId,
        startsAt: body.startsAt,
        idempotencyKey: idempotencyKey ?? undefined,
      },
      bookingCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
