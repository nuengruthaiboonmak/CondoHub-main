import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createBuilding,
  createPropertyCtx,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { buildingBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const body = parseWithFieldErrors(buildingBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    return createBuilding(
      ctx.actor,
      {
        projectId: body.projectId,
        code: body.code,
        name: body.name,
        status: body.status,
      },
      propertyCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
