import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { createIdentityCtx, setAccountStatus } from '@/modules/identity-access/application/index';
import { accountStatusBody, parseWithFieldErrors } from '@/modules/identity-access/application/routeSchemas';

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new Error('Missing user id.');
    }
    const body = parseWithFieldErrors(accountStatusBody, await request.json());
    const identityCtx = createIdentityCtx({ requestId: ctx.requestId });
    return setAccountStatus(ctx.actor, id, body.accountStatus, identityCtx);
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
