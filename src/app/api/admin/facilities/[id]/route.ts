import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { isUuid } from '@/shared/utils/idempotency';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  createBookingCtx,
  deleteFacility,
  facilityPatchBody,
  getFacilityDetail,
  parseWithFieldErrors,
  updateFacilityDetails,
} from '@/modules/facility-booking/application/index';

export const GET = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new AppError('VALIDATION_ERROR', 'The facility id is invalid.');
    }
    const detail = await getFacilityDetail(ctx.actor, id, systemClock.now());
    if (detail === null) throw new AppError('RESOURCE_NOT_FOUND');
    return detail;
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new AppError('VALIDATION_ERROR', 'The facility id is invalid.');
    }
    const body = parseWithFieldErrors(facilityPatchBody, await request.json());
    const bookingCtx = createBookingCtx({ requestId: ctx.requestId });
    return updateFacilityDetails(
      ctx.actor,
      id,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
      },
      bookingCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const DELETE = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (!id || !isUuid(id)) throw new AppError('VALIDATION_ERROR', 'The facility id is invalid.');
    return deleteFacility(ctx.actor, id, createBookingCtx({ requestId: ctx.requestId }));
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
