import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import {
  getChargeEventNote,
  listCommonFeeEvents,
} from '@/modules/billing-payments/application/index';
import {
  Badge,
  DataTable,
  DataTableCell,
  DataTableRow,
  EmptyState,
  FormDialog,
  FilterBar,
  PageHeader,
} from '@/shared/ui';
import { ChargeEventCreateForm } from '@/modules/billing-payments/ui/ChargeEventCreateForm';
import { BillingSectionNav } from '@/modules/billing-payments/ui/BillingSectionNav';

export const dynamic = 'force-dynamic';

function formatAmount(value: { amount: string; currency: string } | null): string {
  if (value === null) return 'Rule-derived amount';
  return `${value.amount} ${value.currency}`;
}

export default async function AdminBillingEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/billing/events');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const query = await searchParams;
  const status = query.status === 'ISSUED' || query.status === 'CANCELLED' ? query.status : 'OPEN';
  const rows = await listCommonFeeEvents(actor, status);
  return (
    <main
      data-testid="charge-event-list-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="One-time billing events"
        description="Create one-time charges, issue their invoices, and review completed or cancelled events."
        actions={
          <FormDialog
            triggerLabel="New billing event"
            title="New one-time event"
            triggerTestId="charge-event-list-new"
            testId="charge-event-create-dialog"
          >
            <ChargeEventCreateForm />
          </FormDialog>
        }
      />
      <BillingSectionNav current="events" counts={{ events: rows.length }} />
      <FilterBar
        label="Event status"
        activeValue={status}
        options={[
          {
            value: 'OPEN',
            label: 'Open',
            href: '/admin/billing/events',
            testId: 'charge-event-filter-open',
          },
          {
            value: 'ISSUED',
            label: 'Issued',
            href: '/admin/billing/events?status=ISSUED',
            testId: 'charge-event-filter-issued',
          },
          {
            value: 'CANCELLED',
            label: 'Cancelled',
            href: '/admin/billing/events?status=CANCELLED',
            testId: 'charge-event-filter-cancelled',
          },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          data-testid="charge-event-list-empty"
          title={`No ${status.toLowerCase()} events`}
          description={
            status === 'OPEN'
              ? 'Create a one-time event, then choose which rooms to bill.'
              : 'Events will appear here after their issuance is completed or cancelled.'
          }
        />
      ) : (
        <DataTable
          testId="charge-event-list"
          caption={`${status.toLowerCase()} one-time billing events`}
          columns={[
            { key: 'event', header: 'Event', width: 360 },
            { key: 'status', header: 'Status', width: 140 },
            { key: 'amount', header: 'Amount', width: 160 },
            { key: 'created', header: 'Created', width: 180 },
          ]}
        >
          {rows.map((row) => {
            const note = getChargeEventNote(row.chargeContext);
            return (
              <DataTableRow key={row.id} rowKey={row.id}>
                <DataTableCell
                  link
                  href={`/admin/billing/events/${row.id}`}
                  linkTestId={`charge-event-row-${row.id}`}
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span>Event {row.eventEffectiveDate}</span>
                    {note ? (
                      <span
                        className="line-clamp-2 whitespace-normal break-words text-small font-normal text-muted-foreground"
                        title={note}
                      >
                        {note}
                      </span>
                    ) : null}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  <Badge
                    data-testid={`charge-event-status-${row.id}`}
                    variant={row.status === 'ISSUED' ? 'success' : 'neutral'}
                  >
                    {row.status}
                  </Badge>
                </DataTableCell>
                <DataTableCell>
                  <span data-testid={`charge-event-amount-${row.id}`} className="ui-tabular">
                    {formatAmount(row.configuredAmount)}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  <span className="ui-tabular">Created {row.createdAt.slice(0, 10)}</span>
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </DataTable>
      )}
    </main>
  );
}
