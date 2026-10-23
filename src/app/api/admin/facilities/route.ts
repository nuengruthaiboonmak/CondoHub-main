import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createBookingCtx,
  createFacility,
  facilityCreateBody,
  parseWithFieldErrors,
} from '@/modules/facility-booking/application/index';

export const POST = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const body = parseWithFieldErrors(facilityCreateBody, await request.json());
    const bookingCtx = createBookingCtx({ requestId: ctx.requestId });
    return createFacility(
      ctx.actor,
      {
        projectId: body.projectId,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        status: body.status,
        capacity: body.capacity,
        schedule: body.schedule,
        slotMinutes: body.slotMinutes,
        quotaKind: body.quotaKind,
        quotaLimit: body.quotaLimit,
        advanceDays: body.advanceDays,
      },
      bookingCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
