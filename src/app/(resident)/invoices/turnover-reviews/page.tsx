import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { Badge, EmptyState, PageHeader, Pagination } from '@/shared/ui';
import { listTurnoverReviews } from '@/modules/billing-payments/application/index';
import { getRoomDetail } from '@/modules/property-membership/application/index';
import { FilterBar } from '@/shared/ui';
import { TurnoverTable } from '@/modules/billing-payments/ui/TurnoverTable';

export const dynamic = 'force-dynamic';

type ReviewState = 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';

const BASE_PATH = '/invoices/turnover-reviews';

function stateFilter(value: string | undefined): ReviewState | undefined {
  if (value === 'UNRESOLVED' || value === 'RESOLVED' || value === 'NO_CHARGE') return value;
  return undefined;
}

function filterHref(state: ReviewState | undefined): string {
  if (state === undefined) return BASE_PATH;
  return `${BASE_PATH}?state=${state}`;
}

export default async function OwnerTurnoverReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; state?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect(`/login?returnUrl=${BASE_PATH}`);
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect(`/login?returnUrl=${BASE_PATH}`);
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
      data-testid="owner-turnover-review-list-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Turnover reviews"
        backHref="/invoices"
        backLabel="Back to bills"
        backTestId="owner-turnover-review-back-to-bills"
        description="Decide who pays rent for months when your room changed tenancy. Unresolved reviews stay here until you issue invoices or record no charge."
        actions={
          <Badge data-testid="owner-turnover-review-unresolved-indicator" variant="warning">
            {feed.unresolvedCount} unresolved
          </Badge>
        }
      />
      <FilterBar
        label="Filter by state"
        activeValue={state ?? 'ALL'}
        options={[
          {
            value: 'ALL',
            testId: 'owner-turnover-review-filter-all',
            href: filterHref(undefined),
            label: 'All',
          },
          {
            value: 'UNRESOLVED',
            testId: 'owner-turnover-review-filter-unresolved',
            href: filterHref('UNRESOLVED'),
            label: 'Unresolved',
          },
          {
            value: 'RESOLVED',
            testId: 'owner-turnover-review-filter-resolved',
            href: filterHref('RESOLVED'),
            label: 'Resolved',
          },
          {
            value: 'NO_CHARGE',
            testId: 'owner-turnover-review-filter-no-charge',
            href: filterHref('NO_CHARGE'),
            label: 'No charge',
          },
        ]}
      />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="owner-turnover-review-list-empty"
          title="No turnover reviews"
          description="When a month in one of your rooms needs a rent decision, the review appears here."
        />
      ) : (
        <TurnoverTable
          rows={feed.rows}
          roomNames={roomNames}
          basePath={BASE_PATH}
          prefix="owner-turnover-review"
          caption="Turnover reviews for your rooms"
          showMode={false}
        />
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={feed.total}
        pagePath={BASE_PATH}
        querySuffix={suffix}
        testId="owner-turnover-review-list-pages"
        nextTestId="owner-turnover-review-list-next"
        prevTestId="owner-turnover-review-list-prev"
        hideDisabledEnds
      />
    </main>
  );
}
