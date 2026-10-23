import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  facilityListQuery,
  listFacilityPage,
  parseWithFieldErrors,
} from '@/modules/facility-booking/application/index';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(facilityListQuery, {
      status: url.searchParams.get('status') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });
    const page = await listFacilityPage(ctx.actor, {
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return paged(page.rows, { page: query.page, pageSize: query.pageSize, total: page.total });
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
