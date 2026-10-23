import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  createTenancy,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { tenancyBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const body = parseWithFieldErrors(tenancyBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    const created = await createTenancy(
      ctx.actor,
      {
        roomId,
        startsAt: new Date(body.startsAt),
        endsAt: body.endsAt === undefined || body.endsAt === null ? null : new Date(body.endsAt),
        managementMode: body.managementMode,
      },
      propertyCtx,
    );
    return {
      id: created.id,
      roomId: created.roomId,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt === null ? null : created.endsAt.toISOString(),
      state: created.state,
      managementMode: created.managementMode,
    };
  },
  { rateLimit: RATE_LIMIT_PRESETS.provision ?? { capacity: 10, windowMs: 3_600_000 } },
);
