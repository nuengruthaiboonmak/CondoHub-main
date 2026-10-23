import 'server-only';
import { redirect } from 'next/navigation';
import { Wrench } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { EmptyState, FilterBar, PageHeader, Pagination } from '@/shared/ui';
import { listTickets } from '@/modules/maintenance/application/index';
import { getRoomLabels } from '@/modules/property-membership/application/index';
import { TicketListCard } from '@/modules/maintenance/ui/TicketListCard';
import { CreateRequestAction } from './CreateRequestAction';

export const dynamic = 'force-dynamic';

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null || actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/maintenance');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const view = params.view === 'history' ? 'history' : 'open';
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const feed = await listTickets(actor, { view, page, pageSize: 20 });
  const labels = new Map(
    (
      await getRoomLabels([
        ...new Set(feed.rows.flatMap((row) => (row.roomId ? [row.roomId] : []))),
      ])
    ).map((row) => [row.id, row.label]),
  );
  return (
    <main
      data-testid="maintenance-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Maintenance"
        description="Report a problem and follow its progress, all in one place."
        actions={<CreateRequestAction actor={actor} />}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          label="Request view"
          activeValue={view}
          options={[
            {
              value: 'open',
              label: 'Open requests',
              href: '/maintenance?view=open',
              testId: 'maintenance-view-open',
            },
            {
              value: 'history',
              label: 'History',
              href: '/maintenance?view=history',
              testId: 'maintenance-view-history',
            },
          ]}
        />
        <span className="text-small text-muted-foreground">
          {feed.total} {feed.total === 1 ? 'request' : 'requests'}
        </span>
      </div>
      <section aria-label={view === 'open' ? 'Open requests' : 'Request history'}>
        {feed.rows.length === 0 ? (
          <EmptyState
            data-testid={`maintenance-${view}-empty`}
            icon={Wrench}
            title={view === 'open' ? 'No open requests' : 'No request history yet'}
            description={
              view === 'open'
                ? 'Your active requests will appear here.'
                : 'Completed, cancelled, and rejected requests will appear here.'
            }
          />
        ) : (
          <ul
            data-testid={view === 'open' ? 'maintenance-open-list' : 'maintenance-history-list'}
            className="flex min-w-0 flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
          >
            {feed.rows.map((row) => (
              <TicketListCard
                key={row.id}
                ticket={row}
                roomLabel={row.roomId ? (labels.get(row.roomId) ?? null) : null}
                detailHref={`/maintenance/${row.id}`}
                testIdPrefix="maintenance"
                showRoutingKind={false}
                nowIso={systemClock.now().toISOString()}
              />
            ))}
          </ul>
        )}
      </section>
      <Pagination
        page={page}
        totalPages={Math.ceil(feed.total / 20)}
        totalItems={feed.total}
        pagePath="/maintenance"
        querySuffix={`&view=${view}`}
        testId="maintenance-pages"
      />
    </main>
  );
}
