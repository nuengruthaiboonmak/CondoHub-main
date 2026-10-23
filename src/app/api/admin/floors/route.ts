import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createFloor,
  createPropertyCtx,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { floorBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const body = parseWithFieldErrors(floorBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    return createFloor(
      ctx.actor,
      {
        buildingId: body.buildingId,
        code: body.code,
        label: body.label,
      },
      propertyCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
