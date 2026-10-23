import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { isUuid } from '@/shared/utils/uuid';
import { systemClock } from '@/shared/utils/clock';
import { EmptyState, PageHeader, Pagination } from '@/shared/ui';
import { getRoomLabels, getTenancyLabels } from '@/modules/property-membership/application/index';
import { listInvoices } from '@/modules/billing-payments/application/index';
import { BillingSectionNav } from '@/modules/billing-payments/ui/BillingSectionNav';
import { FilterBar } from '@/shared/ui';
import { InvoiceTable } from '@/modules/billing-payments/ui/InvoiceTable';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/billing/invoices';

export default async function AdminBillingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; kind?: string; eventId?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/billing/invoices');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const kind =
    params.kind === 'COMMON_FEE' || params.kind === 'PROJECT_MANAGED_RENT'
      ? params.kind
      : undefined;
  const eventId = params.eventId && isUuid(params.eventId) ? params.eventId : undefined;
  const feed = await listInvoices(actor, {
    ...(eventId ? { oneTimeChargeEventId: eventId } : {}),
    page,
    pageSize: 20,
    at: systemClock.now(),
    ...(kind === undefined ? {} : { kind }),
  });
  const roomLabels = Object.fromEntries(
    (await getRoomLabels([...new Set(feed.rows.map((row) => row.roomId))])).map((room) => [
      room.id,
      room.label,
    ]),
  );
  const totalPages = Math.max(1, Math.ceil(feed.total / 20));
  const tenancyLabels = await getTenancyLabels(
    feed.rows.flatMap((row) => (row.tenancyId ? [row.tenancyId] : [])),
  );
  const suffix = `${kind === undefined ? '' : `&kind=${kind}`}${eventId ? `&eventId=${eventId}` : ''}`;
  const filterHref = (target?: string) => {
    const query = new URLSearchParams();
    if (target) query.set('kind', target);
    if (eventId) query.set('eventId', eventId);
    return `${BASE_PATH}${query.size ? `?${query}` : ''}`;
  };
  return (
    <main
      data-testid="admin-invoice-list-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Invoices"
        description="Issued invoices with payment state and outstanding balances. Open an invoice to review slips."
      />
      <BillingSectionNav current="invoices" counts={{}} />
      {eventId ? (
        <a href={`/admin/billing/events/${eventId}`} className="text-small font-medium text-link">
          Back to this billing event
        </a>
      ) : null}
      <FilterBar
        label="Filter by kind"
        activeValue={kind ?? 'ALL'}
        options={[
          { value: 'ALL', testId: 'invoice-filter-all', href: filterHref(), label: 'All' },
          {
            value: 'COMMON_FEE',
            testId: 'invoice-filter-common',
            href: filterHref('COMMON_FEE'),
            label: 'Common fee',
          },
          {
            value: 'PROJECT_MANAGED_RENT',
            testId: 'invoice-filter-rent',
            href: filterHref('PROJECT_MANAGED_RENT'),
            label: 'Project rent',
          },
        ]}
      />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="invoice-list-empty"
          title="No invoices yet"
          description="When the billing job issues invoices, they appear here with totals and due dates."
        />
      ) : (
        <InvoiceTable
          tenancyLabels={tenancyLabels}
          roomLabels={roomLabels}
          rows={feed.rows}
          basePath={BASE_PATH}
          caption="Issued invoices"
        />
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={feed.total}
        pagePath={BASE_PATH}
        querySuffix={suffix}
        testId="invoice-list-pages"
        nextTestId="invoice-list-next"
        prevTestId="invoice-list-prev"
        hideDisabledEnds
      />
    </main>
  );
}
