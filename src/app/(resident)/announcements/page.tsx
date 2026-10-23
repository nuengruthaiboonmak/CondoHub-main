import 'server-only';
import { redirect } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { EmptyState, PageHeader, Pagination } from '@/shared/ui';
import { AnnouncementPreview } from '@/modules/announcements/ui/AnnouncementPreview';
import { listAnnouncementFeed } from '@/modules/announcements/application/index';

export const revalidate = 60;

export default async function AnnouncementsFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/announcements');
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/announcements');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const feed = await listAnnouncementFeed(actor, { page, pageSize: 20 }, systemClock.now());
  const totalPages = Math.max(1, Math.ceil(feed.total / 20));
  return (
    <main
      data-testid="announcements-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Announcements"
        description="Project-wide updates from the management team."
      />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="announcements-empty"
          icon={Megaphone}
          title="No announcements yet"
          description="When the management team publishes an update, it appears here."
        />
      ) : (
        <ul
          data-testid="announcements-list"
          className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3"
        >
          {feed.rows.map((row) => (
            <li key={row.id}>
              <AnnouncementPreview announcement={row} linkTestId={`announcements-row-${row.id}`} />
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={feed.total}
        pagePath="/announcements"
        testId="announcements-pages"
        nextTestId="announcements-next"
        prevTestId="announcements-prev"
        hideDisabledEnds
      />
    </main>
  );
}
