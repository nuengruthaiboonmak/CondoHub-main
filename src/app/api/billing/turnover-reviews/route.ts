import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  listTurnoverReviews,
  parseWithFieldErrors,
  turnoverReviewListQuery,
} from '@/modules/billing-payments/application/index';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(turnoverReviewListQuery, {
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    });
    const page = await listTurnoverReviews(ctx.actor, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.state !== undefined ? { state: query.state } : {}),
    });
    return paged(page.rows, {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      unresolvedCount: page.unresolvedCount,
    });
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
