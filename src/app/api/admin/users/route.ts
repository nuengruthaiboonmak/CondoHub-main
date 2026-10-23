import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  searchUserAccounts,
  createIdentityCtx,
  provisionSystemUser,
} from '@/modules/identity-access/application/index';
import {
  adminProvisionBody,
  parseWithFieldErrors,
  userSearchQuery,
} from '@/modules/identity-access/application/routeSchemas';

export const GET = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(userSearchQuery, {
      query: url.searchParams.get('query') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });
    const result = await searchUserAccounts(ctx.actor, query);
    return paged(
      result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        name: row.name,
        phone: row.phone,
        accountStatus: row.accountStatus,
        mustChangePassword: row.mustChangePassword,
        createdAt: row.createdAt.toISOString(),
      })),
      { page: query.page, pageSize: query.pageSize, total: result.total },
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const POST = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const body = parseWithFieldErrors(adminProvisionBody, await request.json());
    const identityCtx = createIdentityCtx({ requestId: ctx.requestId });
    const result = await provisionSystemUser(ctx.actor, body, identityCtx);
    return result;
  },
  { rateLimit: RATE_LIMIT_PRESETS.provision ?? { capacity: 10, windowMs: 3_600_000 } },
);
