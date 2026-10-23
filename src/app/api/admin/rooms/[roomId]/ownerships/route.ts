import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  correctOwnershipInterval,
  createPropertyCtx,
  parseWithFieldErrors,
  removeOwnership,
  resolveGrantTargetByUsername,
  transferOwnership,
} from '@/modules/property-membership/application/index';
import { ownershipAdminBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const body = parseWithFieldErrors(ownershipAdminBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    if (body.action === 'TRANSFER') {
      let toUserId = body.toUserId ?? null;
      if (body.toUsername !== undefined) {
        const resolved = await resolveGrantTargetByUsername(body.toUsername);
        if (resolved === null) {
          throw new AppError('VALIDATION_ERROR', 'The new owner was not found.');
        }
        toUserId = resolved.userId;
      }
      if (toUserId === null) {
        throw new AppError('VALIDATION_ERROR', 'Provide a user to transfer to.');
      }
      const result = await transferOwnership(
        ctx.actor,
        {
          roomId,
          fromUserId: body.fromUserId,
          toUserId,
          effectiveAt: new Date(body.effectiveAt),
        },
        propertyCtx,
      );
      return {
        endedOwnershipId: result.endedOwnershipId,
        createdOwnershipId: result.createdOwnershipId,
        effectiveAt: result.effectiveAt.toISOString(),
      };
    }
    if (body.action === 'REMOVE') {
      const result = await removeOwnership(
        ctx.actor,
        { roomId, ownershipId: body.ownershipId, effectiveAt: new Date(body.effectiveAt) },
        propertyCtx,
      );
      return { ownershipId: result.ownershipId, effectiveAt: result.effectiveAt.toISOString() };
    }
    const result = await correctOwnershipInterval(
      ctx.actor,
      {
        roomId,
        ownershipId: body.ownershipId,
        startAt: body.startAt === undefined ? undefined : new Date(body.startAt),
        endAt: body.endAt === undefined ? undefined : body.endAt === null ? null : new Date(body.endAt),
        reason: body.reason,
      },
      propertyCtx,
    );
    return { ownershipId: result.ownershipId };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
