import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  announcementListQuery,
  listAnnouncementFeed,
  parseWithFieldErrors,
} from '@/modules/announcements/application/index';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(announcementListQuery, {
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });
    const feed = await listAnnouncementFeed(
      ctx.actor,
      { page: query.page, pageSize: query.pageSize },
      systemClock.now(),
    );
    return paged(
      feed.rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        publishAt: row.publishAt,
        hiddenAt: row.hiddenAt,
        editedAt: row.editedAt,
        revision: row.revision,
        status: row.status,
        images: row.images,
      })),
      { page: query.page, pageSize: query.pageSize, total: feed.total },
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
