import 'server-only';
import { revalidatePath } from 'next/cache';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  closureBody,
  createBookingCtx,
  createClosure,
  parseWithFieldErrors,
} from '@/modules/facility-booking/application/index';

export const POST = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new AppError('VALIDATION_ERROR', 'The facility id is invalid.');
    }
    const body = parseWithFieldErrors(closureBody, await request.json());
    const bookingCtx = createBookingCtx({ requestId: ctx.requestId });
    const created = await createClosure(
      ctx.actor,
      id,
      { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), reason: body.reason },
      bookingCtx,
    );
    revalidatePath('/facilities');
    revalidatePath(`/facilities/${id}`);
    revalidatePath('/admin/facilities');
    revalidatePath(`/admin/facilities/${id}`);
    return created;
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
