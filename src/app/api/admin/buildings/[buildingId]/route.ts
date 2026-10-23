import 'server-only';
import { isUuid } from '@/shared/utils/idempotency';
import { deletePropertyResource } from '@/modules/property-membership/application/index';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  updateBuildingDetails,
  disableBuilding,
  enableBuilding,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { buildingPatchBody } from '@/modules/property-membership/application/routeSchemas';

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const buildingId = params?.buildingId;
    if (buildingId === undefined || !isUuid(buildingId)) {
      throw new AppError('VALIDATION_ERROR', 'The building id is invalid.');
    }
    const body = parseWithFieldErrors(buildingPatchBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    if (body.name !== undefined)
      return updateBuildingDetails(ctx.actor, buildingId, body, propertyCtx);
    if (body.status === 'INACTIVE') {
      return disableBuilding(ctx.actor, buildingId, propertyCtx);
    }
    return enableBuilding(ctx.actor, buildingId, propertyCtx);
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const DELETE = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const id = (await route?.params)?.buildingId;
    if (!id || !isUuid(id)) throw new AppError('VALIDATION_ERROR', 'The resource id is invalid.');
    return deletePropertyResource(
      ctx.actor,
      'building',
      id,
      createPropertyCtx({ requestId: ctx.requestId }),
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
