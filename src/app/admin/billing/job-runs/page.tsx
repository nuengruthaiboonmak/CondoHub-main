import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import {
  Badge,
  DataTable,
  DataTableCell,
  DataTableRow,
  EmptyState,
  PageHeader,
  Pagination,
} from '@/shared/ui';
import { listAdminJobRuns } from '@/modules/billing-payments/application/index';
import type { AdminJobResult } from '@/modules/billing-payments/domain/jobRedaction';
import { formatInstant, jobRunStateVariant } from '@/modules/billing-payments/ui/billingLabels';
import { BillingSectionNav } from '@/modules/billing-payments/ui/BillingSectionNav';
import { FilterBar } from '@/shared/ui';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/billing/job-runs';

function summaryOf(result: AdminJobResult | null): string {
  if (result === null) return 'No aggregate result yet';
  if ('transitioned' in result) {
    return `${result.transitioned} transitioned, ${result.skippedYoung + result.skippedRaced} skipped`;
  }
  return `${result.created} created, ${result.skipped} skipped, ${result.reviewRequired} for review`;
}

export default async function AdminBillingJobRunsPage({
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
  const state =
    params.state === 'RUNNING' || params.state === 'DONE' || params.state === 'ERROR'
      ? params.state
      : undefined;
  const feed = await listAdminJobRuns(actor, {
    page,
    pageSize: 20,
    ...(state === undefined ? {} : { state }),
  });
  const totalPages = Math.max(1, Math.ceil(feed.total / 20));
  const suffix = state === undefined ? '' : `&state=${state}`;
  return (
    <main
      data-testid="job-run-list-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Billing job runs"
        description="Aggregate invoice counts only. Per-room and per-owner detail never appears here."
      />
      <BillingSectionNav current="jobs" counts={{}} />
      <FilterBar
        label="Filter by state"
        activeValue={state ?? 'ALL'}
        options={[
          { value: 'ALL', testId: 'job-run-filter-all', href: BASE_PATH, label: 'All' },
          {
            value: 'DONE',
            testId: 'job-run-filter-done',
            href: `${BASE_PATH}?state=DONE`,
            label: 'Done',
          },
          {
            value: 'ERROR',
            testId: 'job-run-filter-error',
            href: `${BASE_PATH}?state=ERROR`,
            label: 'Errors',
          },
          {
            value: 'RUNNING',
            testId: 'job-run-filter-running',
            href: `${BASE_PATH}?state=RUNNING`,
            label: 'Running',
          },
        ]}
      />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="job-run-list-empty"
          title="No job runs yet"
          description="When the billing job runs, each attempt and its aggregate result lands here."
        />
      ) : (
        <DataTable
          testId="job-run-list"
          caption="Billing job runs"
          columns={[
            { key: 'run', header: 'Run' },
            { key: 'state', header: 'State' },
            { key: 'summary', header: 'Summary' },
            { key: 'attempt', header: 'Attempt', numeric: true },
            { key: 'started', header: 'Started', numeric: true },
          ]}
        >
          {feed.rows.map((row) => (
            <DataTableRow key={row.id} rowKey={row.id}>
              <DataTableCell
                link
                href={`${BASE_PATH}/${row.id}`}
                linkTestId={`job-run-row-${row.id}`}
              >
                {row.jobName} · {row.businessKey}
              </DataTableCell>
              <DataTableCell>
                <Badge
                  data-testid={`job-run-state-${row.id}`}
                  variant={jobRunStateVariant(row.state)}
                >
                  {row.state}
                </Badge>
              </DataTableCell>
              <DataTableCell>
                <span data-testid={`job-run-summary-${row.id}`}>{summaryOf(row.result)}</span>
              </DataTableCell>
              <DataTableCell numeric>
                <span className="ui-tabular">Attempt {row.attempt}</span>
              </DataTableCell>
              <DataTableCell numeric>
                <span className="ui-tabular">{formatInstant(row.startedAt)}</span>
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTable>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={feed.total}
        pagePath={BASE_PATH}
        querySuffix={suffix}
        testId="job-run-list-pages"
        nextTestId="job-run-list-next"
        prevTestId="job-run-list-prev"
        hideDisabledEnds
      />
    </main>
  );
}
