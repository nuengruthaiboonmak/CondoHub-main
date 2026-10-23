import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey } from '@/shared/utils/idempotency';
import {
  createMaintenanceCtx,
  createTicket,
  listTickets,
  parseWithFieldErrors,
  ticketCreateBody,
  ticketListQuery,
} from '@/modules/maintenance/application/index';

export const dynamic = 'force-dynamic';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(ticketListQuery, {
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      roomId: url.searchParams.get('roomId') ?? undefined,
      routingKind: url.searchParams.get('routingKind') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      view: url.searchParams.get('view') ?? undefined,
    });
    const page = await listTickets(ctx.actor, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.roomId !== undefined ? { roomId: query.roomId } : {}),
      ...(query.routingKind !== undefined ? { routingKind: query.routingKind } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.view !== undefined ? { view: query.view } : {}),
    });
    return paged(page.rows, { page: query.page, pageSize: query.pageSize, total: page.total });
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const POST = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const body = parseWithFieldErrors(ticketCreateBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const maintenanceCtx = createMaintenanceCtx({ requestId: ctx.requestId });
    return createTicket(
      ctx.actor,
      {
        routingKind: body.routingKind,
        ...(body.roomId !== undefined && body.roomId !== null ? { roomId: body.roomId } : {}),
        locationDescription: body.locationDescription,
        subject: body.subject,
        description: body.description,
        imageIds: body.imageIds,
        ...(idempotencyKey !== null ? { idempotencyKey } : {}),
      },
      maintenanceCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
