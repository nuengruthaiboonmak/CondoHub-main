import 'server-only';
import { revalidatePath } from 'next/cache';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey } from '@/shared/utils/idempotency';
import {
  commitConfigChange,
  configCommitBody,
  createBookingCtx,
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
    const body = parseWithFieldErrors(configCommitBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const bookingCtx = createBookingCtx({ requestId: ctx.requestId });
    const committed = await commitConfigChange(
      ctx.actor,
      id,
      {
        schedule: body.schedule,
        slotMinutes: body.slotMinutes,
        capacity: body.capacity,
        quotaKind: body.quotaKind,
        quotaLimit: body.quotaLimit,
        advanceDays: body.advanceDays,
        effectiveAt: new Date(body.effectiveAt),
        previewToken: body.previewToken,
        idempotencyKey: idempotencyKey ?? undefined,
      },
      bookingCtx,
    );
    revalidatePath('/facilities');
    revalidatePath(`/facilities/${id}`);
    revalidatePath('/admin/facilities');
    revalidatePath(`/admin/facilities/${id}`);
    return committed;
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
