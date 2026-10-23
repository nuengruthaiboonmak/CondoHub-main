import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  addMembership,
  createPropertyCtx,
  parseWithFieldErrors,
  resolveGrantTargetByUsername,
} from '@/modules/property-membership/application/index';
import { memberAddBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const body = parseWithFieldErrors(memberAddBody, await request.json());
    let userId = body.userId ?? null;
    if (userId === null && body.username !== undefined) {
      const resolved = await resolveGrantTargetByUsername(body.username);
      if (resolved === null) {
        throw new AppError('VALIDATION_ERROR', 'The member user was not found.');
      }
      userId = resolved.userId;
    }
    if (userId === null) {
      throw new AppError('VALIDATION_ERROR', 'Provide a userId or username.');
    }
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    const created = await addMembership(
      ctx.actor,
      {
        roomId,
        userId,
        memberRole: body.memberRole,
        tenancyId: body.tenancyId ?? null,
      },
      propertyCtx,
    );
    return {
      id: created.id,
      roomId: created.roomId,
      tenancyId: created.tenancyId,
      userId: created.userId,
      memberRole: created.memberRole,
      startAt: created.startAt.toISOString(),
      endAt: null,
    };
  },
  { rateLimit: RATE_LIMIT_PRESETS.provision ?? { capacity: 10, windowMs: 3_600_000 } },
);
