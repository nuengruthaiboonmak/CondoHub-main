import 'server-only';
import { isUuid } from '@/shared/utils/idempotency';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  deleteFloor,
  parseWithFieldErrors,
  updateFloor,
} from '@/modules/property-membership/application/index';
import { floorPatchBody } from '@/modules/property-membership/application/routeSchemas';

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const floorId = params?.floorId;
    if (floorId === undefined || !isUuid(floorId)) {
      throw new AppError('VALIDATION_ERROR', 'The floor id is invalid.');
    }
    const body = parseWithFieldErrors(floorPatchBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    return updateFloor(
      ctx.actor,
      { floorId, code: body.code, label: body.label, status: body.status },
      propertyCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const DELETE = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const floorId = params?.floorId;
    if (floorId === undefined || !isUuid(floorId)) {
      throw new AppError('VALIDATION_ERROR', 'The floor id is invalid.');
    }
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    return deleteFloor(ctx.actor, floorId, propertyCtx);
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
