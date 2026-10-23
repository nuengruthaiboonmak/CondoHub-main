import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  invoiceListQuery,
  listInvoices,
  parseWithFieldErrors,
} from '@/modules/billing-payments/application/index';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(invoiceListQuery, {
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      roomId: url.searchParams.get('roomId') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      oneTimeChargeEventId: url.searchParams.get('oneTimeChargeEventId') ?? undefined,
    });
    const page = await listInvoices(ctx.actor, {
      page: query.page,
      pageSize: query.pageSize,
      at: systemClock.now(),
      ...(query.roomId !== undefined ? { roomId: query.roomId } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.oneTimeChargeEventId !== undefined
        ? { oneTimeChargeEventId: query.oneTimeChargeEventId }
        : {}),
    });
    return paged(page.rows, { page: query.page, pageSize: query.pageSize, total: page.total });
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
