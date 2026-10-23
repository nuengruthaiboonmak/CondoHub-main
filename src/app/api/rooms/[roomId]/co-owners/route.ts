import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey } from '@/shared/utils/idempotency';
import {
  createPropertyCtx,
  grantCoOwner,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { coOwnerGrantBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const body = parseWithFieldErrors(coOwnerGrantBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    const result = await grantCoOwner(
      ctx.actor,
      {
        roomId,
        userId: body.userId,
        username: body.username,
        email: body.email,
        name: body.name,
        phone: body.phone,
        idempotencyKey: idempotencyKey ?? undefined,
      },
      propertyCtx,
    );
    return {
      ownershipId: result.ownershipId,
      userId: result.userId,
      startAt: result.startAt.toISOString(),
      ...(result.tempPassword !== undefined ? { tempPassword: result.tempPassword } : {}),
    };
  },
  { rateLimit: RATE_LIMIT_PRESETS.provision ?? { capacity: 10, windowMs: 3_600_000 } },
);
