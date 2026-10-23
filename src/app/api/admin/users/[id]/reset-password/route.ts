import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { createIdentityCtx, resetPassword } from '@/modules/identity-access/application/index';

export const POST = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new Error('Missing user id.');
    }
    const identityCtx = createIdentityCtx({ requestId: ctx.requestId });
    return resetPassword(ctx.actor, id, identityCtx);
  },
  { rateLimit: RATE_LIMIT_PRESETS.passwordReset ?? { capacity: 10, windowMs: 3_600_000 } },
);
