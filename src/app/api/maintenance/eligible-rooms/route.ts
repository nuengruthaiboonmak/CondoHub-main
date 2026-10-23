import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  eligibleRoomsQuery,
  listEligibleRooms,
  parseWithFieldErrors,
} from '@/modules/maintenance/application/index';

export const dynamic = 'force-dynamic';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(eligibleRoomsQuery, {
      routingKind: url.searchParams.get('routingKind') ?? undefined,
    });
    return listEligibleRooms(ctx.actor, query.routingKind, systemClock.now());
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
