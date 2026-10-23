import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { createIdentityCtx, deleteUser } from '@/modules/identity-access/application/index';

export const DELETE = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const id = (await route?.params)?.id;
    if (!id) throw new AppError('VALIDATION_ERROR', 'The user id is invalid.');
    return deleteUser(ctx.actor, id, createIdentityCtx({ requestId: ctx.requestId }));
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
