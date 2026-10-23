import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  jobRunListQuery,
  listAdminJobRuns,
  parseWithFieldErrors,
} from '@/modules/billing-payments/application/index';

export const GET = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(jobRunListQuery, {
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      jobName: url.searchParams.get('jobName') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    });
    const page = await listAdminJobRuns(
      ctx.actor,
      {
        page: query.page,
        pageSize: query.pageSize,
        ...(query.jobName !== undefined ? { jobName: query.jobName } : {}),
        ...(query.state !== undefined ? { state: query.state } : {}),
      },
    );
    return paged(page.rows, { page: query.page, pageSize: query.pageSize, total: page.total });
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
