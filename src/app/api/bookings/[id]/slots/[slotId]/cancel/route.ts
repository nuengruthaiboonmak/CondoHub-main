import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  cancelBookingSlot,
  createBookingCtx,
  parseWithFieldErrors,
  slotCancelBody,
} from '@/modules/facility-booking/application/index';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    const slotId = params?.slotId;
    if (id === undefined || id === '' || slotId === undefined || slotId === '') {
      throw new AppError('VALIDATION_ERROR', 'The booking id is invalid.');
    }
    const body = parseWithFieldErrors(slotCancelBody, await request.json());
    const bookingCtx = createBookingCtx({ requestId: ctx.requestId });
    return cancelBookingSlot(
      ctx.actor,
      { bookingId: id, slotId, reason: body.reason, refundQuota: body.refundQuota },
      bookingCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
