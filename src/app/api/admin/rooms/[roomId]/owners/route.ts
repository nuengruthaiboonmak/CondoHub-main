import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey } from '@/shared/utils/idempotency';
import {
  assignOwner,
  createPropertyCtx,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { ownerAssignBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const body = parseWithFieldErrors(ownerAssignBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    const result = await assignOwner(
      ctx.actor,
      {
        roomId,
        userId: body.userId,
        username: body.username,
        email: body.email,
        name: body.name,
        phone: body.phone,
        effectiveAt: body.effectiveAt === undefined ? undefined : new Date(body.effectiveAt),
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
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
