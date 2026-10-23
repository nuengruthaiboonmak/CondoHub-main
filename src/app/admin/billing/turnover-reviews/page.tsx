import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { Badge, EmptyState, PageHeader, Pagination } from '@/shared/ui';
import { listTurnoverReviews } from '@/modules/billing-payments/application/index';
import { getRoomDetail } from '@/modules/property-membership/application/index';
import { BillingSectionNav } from '@/modules/billing-payments/ui/BillingSectionNav';
import { FilterBar } from '@/shared/ui';
import { TurnoverTable } from '@/modules/billing-payments/ui/TurnoverTable';

export const dynamic = 'force-dynamic';

type ReviewState = 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';

const BASE_PATH = '/admin/billing/turnover-reviews';

function stateFilter(value: string | undefined): ReviewState | undefined {
  if (value === 'UNRESOLVED' || value === 'RESOLVED' || value === 'NO_CHARGE') return value;
  return undefined;
}

function filterHref(state: ReviewState | undefined): string {
  if (state === undefined) return BASE_PATH;
  return `${BASE_PATH}?state=${state}`;
}

export default async function AdminTurnoverReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; state?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect(`/login?returnUrl=${BASE_PATH}`);
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const state = stateFilter(params.state);
  const feed = await listTurnoverReviews(actor, {
    page,
    pageSize: 20,
    ...(state === undefined ? {} : { state }),
  });
  const roomNames = new Map<string, string>();
  for (const row of feed.rows) {
    if (roomNames.has(row.roomId)) continue;
    try {
      const room = await getRoomDetail(row.roomId);
      roomNames.set(row.roomId, room.name);
    } catch {
      roomNames.set(row.roomId, row.roomId);
    }
  }
  const totalPages = Math.max(1, Math.ceil(feed.total / 20));
  const suffix = state === undefined ? '' : `&state=${state}`;
  return (
    <main
      data-testid="turnover-review-list-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Turnover reviews"
        description="Decide who pays rent when a month has more than one tenancy. No deadlines, no automatic billing."
      />
      <BillingSectionNav current="turnover" counts={{}} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge data-testid="turnover-review-unresolved-indicator" variant="warning">
          {feed.unresolvedCount} unresolved
        </Badge>
      </div>
      <FilterBar
        label="Filter by state"
        activeValue={state ?? 'ALL'}
        options={[
          {
            value: 'ALL',
            testId: 'turnover-review-filter-all',
            href: filterHref(undefined),
            label: 'All',
          },
          {
            value: 'UNRESOLVED',
            testId: 'turnover-review-filter-unresolved',
            href: filterHref('UNRESOLVED'),
            label: 'Unresolved',
          },
          {
            value: 'RESOLVED',
            testId: 'turnover-review-filter-resolved',
            href: filterHref('RESOLVED'),
            label: 'Resolved',
          },
          {
            value: 'NO_CHARGE',
            testId: 'turnover-review-filter-no-charge',
            href: filterHref('NO_CHARGE'),
            label: 'No charge',
          },
        ]}
      />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="turnover-review-list-empty"
          title="No turnover reviews"
          description="When the billing job finds more than one tenancy in a month, the review lands here for a decision."
        />
      ) : (
        <TurnoverTable
          rows={feed.rows}
          roomNames={roomNames}
          basePath={BASE_PATH}
          prefix="turnover-review"
          caption="Turnover reviews awaiting a rent decision"
          showMode
        />
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={feed.total}
        pagePath={BASE_PATH}
        querySuffix={suffix}
        testId="turnover-review-list-pages"
        nextTestId="turnover-review-list-next"
        prevTestId="turnover-review-list-prev"
        hideDisabledEnds
      />
    </main>
  );
}
