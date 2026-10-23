import 'server-only';
import { redirect } from 'next/navigation';
import { Wrench } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { EmptyState, FilterBar, PageHeader, Pagination } from '@/shared/ui';
import { listTickets, type TicketDto } from '@/modules/maintenance/application/index';
import { isTerminalTicketStatus } from '@/modules/maintenance/ui/ticketLabels';
import { TicketListCard } from '@/modules/maintenance/ui/TicketListCard';
import { getRoomLabels } from '@/modules/property-membership/application/index';

export const dynamic = 'force-dynamic';

const STATUS_FILTERS = [
  'PENDING',
  'IN_PROGRESS',
  'WAITING_FOR_INFO',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

function statusFilterLabel(status: string): string {
  if (status === 'IN_PROGRESS') return 'In progress';
  if (status === 'WAITING_FOR_INFO') return 'Waiting for info';
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'REJECTED') return 'Rejected';
  if (status === 'CANCELLED') return 'Cancelled';
  return 'Pending';
}

function statusSlug(status: string): string {
  return status.toLowerCase().replaceAll('_', '-');
}

export default async function AdminMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; page?: string; view?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/maintenance');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const status = STATUS_FILTERS.find((entry) => entry === params.status);
  const view =
    status !== undefined
      ? isTerminalTicketStatus(status)
        ? 'history'
        : 'open'
      : params.view === 'history'
        ? 'history'
        : 'open';
  const kind =
    params.kind === 'COMMON_AREA' || params.kind === 'PROJECT_MANAGED_PRIVATE'
      ? params.kind
      : undefined;
  const feed = await listTickets(actor, {
    page,
    pageSize: 20,
    view,
    ...(status === undefined ? {} : { status }),
    ...(kind === undefined ? {} : { routingKind: kind }),
  });
  const open = feed.rows.filter((row: TicketDto) => !isTerminalTicketStatus(row.status));
  const history = feed.rows.filter((row: TicketDto) => isTerminalTicketStatus(row.status));
  const labels = new Map(
    (
      await getRoomLabels([
        ...new Set(feed.rows.flatMap((row) => (row.roomId ? [row.roomId] : []))),
      ])
    ).map((row) => [row.id, row.label]),
  );
  const totalPages = Math.max(1, Math.ceil(feed.total / 20));
  const statusQuery = status === undefined ? '' : `status=${status}`;
  const kindQuery = (target: string | undefined): string => {
    const query = new URLSearchParams({ view });
    if (target !== undefined) query.set('kind', target);
    if (status !== undefined) query.set('status', status);
    const text = query.toString();
    return text === '' ? '/admin/maintenance' : `/admin/maintenance?${text}`;
  };
  const statusHref = (target: string | undefined): string => {
    const query = new URLSearchParams({
      view: target === undefined ? view : isTerminalTicketStatus(target) ? 'history' : 'open',
    });
    if (kind !== undefined) query.set('kind', kind);
    if (target !== undefined) query.set('status', target);
    const text = query.toString();
    return text === '' ? '/admin/maintenance' : `/admin/maintenance?${text}`;
  };
  const suffixParts = [
    `view=${view}`,
    statusQuery,
    kind === undefined ? '' : `kind=${kind}`,
  ].filter((part) => part !== '');
  const suffix = suffixParts.length === 0 ? '' : `&${suffixParts.join('&')}`;
  const nowIso = systemClock.now().toISOString();
  return (
    <main
      data-testid="admin-maintenance-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Maintenance inbox"
        description="Common-area and project-managed requests routed to the management team. Owner-room requests stay with the room owners and never appear here."
        actions={
          <span className="inline-flex items-center gap-2 text-small leading-small text-muted-foreground">
            {feed.total === 1 ? '1 request' : `${feed.total} requests`}
          </span>
        }
      />
      <FilterBar
        label="Request view"
        activeValue={view}
        options={[
          {
            value: 'open',
            label: 'Open requests',
            href: '/admin/maintenance?view=open',
            testId: 'admin-maintenance-view-open',
          },
          {
            value: 'history',
            label: 'History',
            href: '/admin/maintenance?view=history',
            testId: 'admin-maintenance-view-history',
          },
        ]}
      />
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <FilterBar
          label="Filter by category"
          activeValue={kind ?? ''}
          options={[
            {
              value: '',
              label: 'All',
              href: kindQuery(undefined),
              testId: 'admin-maintenance-filter-all',
            },
            {
              value: 'COMMON_AREA',
              label: 'Common area',
              href: kindQuery('COMMON_AREA'),
              testId: 'admin-maintenance-filter-common',
            },
            {
              value: 'PROJECT_MANAGED_PRIVATE',
              label: 'Managed room',
              href: kindQuery('PROJECT_MANAGED_PRIVATE'),
              testId: 'admin-maintenance-filter-managed',
            },
          ]}
        />
        <FilterBar
          label="Filter by status"
          activeValue={status ?? ''}
          options={[
            {
              value: '',
              label: 'Any status',
              href: statusHref(undefined),
              testId: 'admin-maintenance-filter-any-status',
            },
            ...STATUS_FILTERS.map((entry) => ({
              value: entry,
              label: statusFilterLabel(entry),
              href: statusHref(entry),
              testId: `admin-maintenance-filter-${statusSlug(entry)}`,
            })),
          ]}
        />
      </div>

      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="admin-maintenance-empty"
          icon={Wrench}
          title="Inbox clear"
          description="No requests match this filter right now."
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          <section
            hidden={view !== 'open'}
            aria-label="Open requests"
            className="flex min-w-0 flex-col gap-2"
          >
            <h2 className="text-heading leading-heading font-semibold text-foreground">
              Open ({open.length})
            </h2>
            {open.length === 0 ? (
              <p
                data-testid="admin-maintenance-open-empty"
                className="text-small leading-small text-muted-foreground"
              >
                No open requests in this view.
              </p>
            ) : (
              <ul
                data-testid="admin-maintenance-open-list"
                className="flex min-w-0 flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
              >
                {open.map((row) => (
                  <TicketListCard
                    key={row.id}
                    ticket={row}
                    roomLabel={row.roomId === null ? null : (labels.get(row.roomId) ?? null)}
                    detailHref={`/admin/maintenance/${row.id}`}
                    testIdPrefix="admin-maintenance"
                    nowIso={nowIso}
                  />
                ))}
              </ul>
            )}
          </section>
          <section
            hidden={view !== 'history'}
            aria-label="Request history"
            className="flex min-w-0 flex-col gap-2"
          >
            <h2 className="text-heading leading-heading font-semibold text-foreground">
              History ({history.length})
            </h2>
            {history.length === 0 ? (
              <p
                data-testid="admin-maintenance-history-empty"
                className="text-small leading-small text-muted-foreground"
              >
                Closed requests will appear here.
              </p>
            ) : (
              <ul
                data-testid="admin-maintenance-history-list"
                className="flex min-w-0 flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
              >
                {history.map((row) => (
                  <TicketListCard
                    key={row.id}
                    ticket={row}
                    roomLabel={row.roomId === null ? null : (labels.get(row.roomId) ?? null)}
                    detailHref={`/admin/maintenance/${row.id}`}
                    testIdPrefix="admin-maintenance"
                    nowIso={nowIso}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={feed.total}
        pagePath="/admin/maintenance"
        querySuffix={suffix}
        testId="admin-maintenance-pages"
        nextTestId="admin-maintenance-next"
        prevTestId="admin-maintenance-prev"
        hideDisabledEnds
      />
    </main>
  );
}
