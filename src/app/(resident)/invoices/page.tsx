import 'server-only';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import {
  ACTION_LINK_SECONDARY_CLASS,
  EmptyState,
  FilterBar,
  PageHeader,
  Pagination,
} from '@/shared/ui';
import { getRoomLabels, getTenancyLabels } from '@/modules/property-membership/application/index';
import { listInvoices, listTurnoverReviews } from '@/modules/billing-payments/application/index';
import { InvoiceTable } from '@/modules/billing-payments/ui/InvoiceTable';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; view?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/invoices');
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/invoices');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const view = params.view === 'receivable' ? 'receivable' : 'payable';
  const at = systemClock.now();
  const [feed, otherFeed, reviews] = await Promise.all([
    listInvoices(actor, { page, pageSize: 20, view, at }),
    listInvoices(actor, {
      page: 1,
      pageSize: 1,
      view: view === 'receivable' ? 'payable' : 'receivable',
      at,
    }),
    listTurnoverReviews(actor, { page: 1, pageSize: 1 }),
  ]);
  const receivableCount = view === 'receivable' ? feed.total : otherFeed.total;
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
  return (
    <main
      data-testid="invoice-list-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title={view === 'receivable' ? 'Rent to collect' : 'Bills'}
        description={
          view === 'receivable'
            ? 'Review rent invoices and tenant payments, including paid invoices.'
            : 'Bills for you and your household. Open a bill to view payment details or submit a slip.'
        }
        actions={
          reviews.total > 0 ? (
            <Link
              data-testid="invoice-turnover-reviews"
              href="/invoices/turnover-reviews"
              className={ACTION_LINK_SECONDARY_CLASS}
            >
              <ClipboardList aria-hidden="true" className="size-4" />
              Turnover reviews
            </Link>
          ) : null
        }
      />
      {receivableCount > 0 || view === 'receivable' ? (
        <FilterBar
          label="Invoice view"
          activeValue={view}
          options={[
            {
              value: 'payable',
              label: 'Bills to pay',
              href: '/invoices',
              testId: 'invoice-view-payable',
            },
            {
              value: 'receivable',
              label: 'Rent to collect',
              href: '/invoices?view=receivable',
              testId: 'invoice-view-receivable',
            },
          ]}
        />
      ) : null}
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="invoice-list-empty"
          title={view === 'receivable' ? 'No rent invoices yet' : 'No bills yet'}
          description={
            view === 'receivable'
              ? 'Rent invoices you are responsible for reviewing appear here.'
              : 'When new bills are issued for your rooms, they appear here.'
          }
        />
      ) : (
        <InvoiceTable
          tenancyLabels={tenancyLabels}
          roomLabels={roomLabels}
          rows={feed.rows}
          basePath="/invoices"
          caption={view === 'receivable' ? 'Rental income invoices' : 'Bills issued for your rooms'}
        />
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={feed.total}
        pagePath="/invoices"
        querySuffix={view === 'receivable' ? '&view=receivable' : ''}
        testId="invoice-list-pages"
        nextTestId="invoice-list-next"
        prevTestId="invoice-list-prev"
        hideDisabledEnds
      />
    </main>
  );
}
