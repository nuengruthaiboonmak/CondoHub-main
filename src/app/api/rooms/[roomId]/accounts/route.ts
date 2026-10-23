import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey } from '@/shared/utils/idempotency';
import { createIdentityCtx, provisionUser } from '@/modules/identity-access/application/index';
import { getRoomProvisioningPorts } from '@/modules/identity-access/application/roomProvisioningPorts';
import { wireRoomProvisioningPorts } from '@/modules/property-membership/application/provisioningPorts';
import {
  parseWithFieldErrors,
  provisionAccountBody,
} from '@/modules/identity-access/application/routeSchemas';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const roomId = params?.roomId;
    if (roomId === undefined || roomId === '') {
      throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
    }
    const body = parseWithFieldErrors(provisionAccountBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const identityCtx = createIdentityCtx({ requestId: ctx.requestId });
    wireRoomProvisioningPorts();
    const ports = getRoomProvisioningPorts();
    return provisionUser(
      ctx.actor,
      {
        roomId,
        username: body.username,
        email: body.email,
        name: body.name,
        phone: body.phone,
        targetRole: body.targetRole,
        idempotencyKey: idempotencyKey ?? undefined,
      },
      identityCtx,
      {
        entitlements: { resolve: (actor, id) => ports.resolveEntitlement(actor, id) },
        memberships: { attach: (tx, input) => ports.attachMembership(tx, input) },
      },
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.provision ?? { capacity: 10, windowMs: 3_600_000 } },
);
