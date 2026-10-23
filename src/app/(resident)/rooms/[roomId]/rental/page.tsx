import 'server-only';
import { AccountAccessBadge } from '@/modules/identity-access/ui/AccountAccessBadge';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { Check, Circle, CreditCard, Users, Wrench } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock, formatProjectDate, projectDateParts } from '@/shared/utils/clock';
import { PROJECT_TIMEZONE } from '@/config/project';
import {
  canActInRoom,
  getCurrentOwners,
  getRoomDetail,
  getRoomLabels,
  listRoomMemberships,
  listRoomTenancies,
  formatTenancyPeriod,
} from '@/modules/property-membership/application/index';
import { getPeopleProfiles } from '@/modules/identity-access/application/index';
import {
  canManageRent,
  getRentSettings,
  getProjectPaymentSettings,
  getRoomPaymentSettings,
  listInvoices,
} from '@/modules/billing-payments/application/index';
import { listTickets, listEligibleRooms } from '@/modules/maintenance/application/index';
import { RentSettingsForm, RentInvoiceForm } from '@/modules/billing-payments/ui/RentSettingsForm';
import { InvoiceTable } from '@/modules/billing-payments/ui/InvoiceTable';
import { RentalTenantForm } from '@/modules/property-membership/ui/RentalTenantForm';
import { PaymentSettingsForm } from '@/modules/billing-payments/ui/PaymentSettingsForm';
import { TenancyCreateForm } from '@/modules/property-membership/ui/TenancyCreateForm';
import { TenancyEndButton } from '@/modules/property-membership/ui/TenancyEndButton';
import { EndMembershipButton } from '@/modules/property-membership/ui/EndMembershipButton';
import { TicketCreateForm } from '@/modules/maintenance/ui/TicketCreateForm';
import { TicketListCard } from '@/modules/maintenance/ui/TicketListCard';
import {
  ACTION_LINK_SECONDARY_CLASS,
  Badge,
  EmptyState,
  FormDialog,
  PageHeader,
  Pagination,
  SectionCard,
} from '@/shared/ui';

const date = (value: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: PROJECT_TIMEZONE, dateStyle: 'medium' }).format(
    value,
  );
export default async function RentalPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{
    tenancyId?: string;
    invoicePage?: string;
    requestPage?: string;
    view?: string;
  }>;
}) {
  const actor = await getActorFromSession();
  if (!actor) redirect('/login');
  if (actor.mustChangePassword) redirect('/change-password');
  const { roomId } = await params;
  const query = await searchParams;
  const now = systemClock.now();
  const verdict = await canActInRoom(actor.userId, roomId, 'VIEW_ROOM', now).catch(() => null);
  if (!actor.isSystemAdmin && !verdict?.allowed) notFound();
  const room = await getRoomDetail(roomId).catch(() => null);
  if (!room) notFound();
  const [owners, periods, members, labels] = await Promise.all([
    getCurrentOwners(roomId, now),
    listRoomTenancies(roomId),
    listRoomMemberships(roomId),
    getRoomLabels([roomId]),
  ]);
  const owner = owners.some((row) => row.userId === actor.userId);
  const current = periods.find(
    (row) => row.state === 'ACTIVE' && row.startsAt <= now && (!row.endsAt || row.endsAt > now),
  );
  const tenancy =
    periods.find((row) => row.id === query.tenancyId) ??
    current ??
    periods.find((row) => row.state === 'ACTIVE' && row.startsAt > now) ??
    periods[0];
  const live = !!tenancy && tenancy.state === 'ACTIVE' && (!tenancy.endsAt || tenancy.endsAt > now);
  const manage =
    !!tenancy && live && canManageRent(actor.isSystemAdmin, owner, tenancy.managementMode);
  const memberVerdict = await canActInRoom(actor.userId, roomId, 'MANAGE_MEMBERS', now);
  const managePeople =
    live &&
    (actor.isSystemAdmin || manage || (memberVerdict.allowed && tenancy?.id === current?.id));
  const createAccount =
    tenancy?.id === current?.id && (manage || (!actor.isSystemAdmin && memberVerdict.allowed));
  const ownMembers = members.filter(
    (row) => row.tenancyId === tenancy?.id && live && (!row.endAt || row.endAt > now),
  );
  const people = await getPeopleProfiles(ownMembers.map((person) => person.userId));
  const profiles = new Map(people.map((person) => [person.userId, person.name]));
  const accountStates = new Map(people.map((person) => [person.userId, person.status]));
  const month = formatProjectDate(projectDateParts(now)).slice(0, 7);
  const value = manage && tenancy ? await getRentSettings(actor, roomId, tenancy.id, now) : null;
  const account = manage
    ? actor.isSystemAdmin
      ? await getProjectPaymentSettings(actor, now)
      : await getRoomPaymentSettings(actor, roomId, 'OWNER', now)
    : null;
  const view = query.view === 'payments' || query.view === 'maintenance' ? query.view : 'overview';
  const canEnd =
    live &&
    tenancy !== undefined &&
    (actor.isSystemAdmin || (owner && tenancy.managementMode === 'PRIVATE_OWNER_MANAGED'));
  const invoicePage = Math.max(1, Math.floor(Number(query.invoicePage) || 1));
  const requestPage = Math.max(1, Math.floor(Number(query.requestPage) || 1));
  const kind =
    tenancy?.managementMode === 'PROJECT_MANAGED' ? 'PROJECT_MANAGED_RENT' : 'PRIVATE_RENT';
  const [invoices, requests, eligible] = await Promise.all([
    actor.isSystemAdmin && kind === 'PRIVATE_RENT'
      ? Promise.resolve({ rows: [], total: 0 })
      : listInvoices(actor, { roomId, kind, page: invoicePage, pageSize: 5, at: now }),
    listTickets(actor, { roomId, page: requestPage, pageSize: 5 }),
    actor.isSystemAdmin
      ? Promise.resolve({ roomIds: [] })
      : listEligibleRooms(
          actor,
          current?.managementMode === 'PROJECT_MANAGED'
            ? 'PROJECT_MANAGED_PRIVATE'
            : 'PRIVATE_OWNER',
          now,
        ),
  ]);
  const base = `/rooms/${roomId}/rental`;
  const tenancyLabels = Object.fromEntries(
    periods.map((period) => [period.id, formatTenancyPeriod(period)]),
  );
  const selected = tenancy ? `&tenancyId=${tenancy.id}` : '';
  const viewHref = (target: string) => `${base}?view=${target}${selected}`;
  const steps = [
    { label: 'Add a tenant', done: ownMembers.length > 0, href: viewHref('overview') },
    { label: 'Set monthly rent', done: value !== null, href: viewHref('payments') },
    { label: 'Set receiving account', done: account !== null, href: viewHref('payments') },
  ];
  const remaining = steps.filter((step) => !step.done);
  const readyToBill = ownMembers.length > 0 && value !== null && account !== null;
  const roomOption = { id: roomId, label: labels[0]?.label ?? room.name };
  return (
    <main
      data-testid="room-rental-page"
      data-tenancy-id={tenancy?.id}
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-6 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        className="[&>div]:sm:flex-col [&>div]:lg:flex-row"
        title="Rental management"
        description={labels[0]?.label ?? room.name}
        backHref={`/rooms/${roomId}`}
        backLabel="Back to room"
        actions={
          actor.isSystemAdmin || owner ? (
            <FormDialog
              triggerLabel={tenancy ? 'New rental period' : 'Start a rental'}
              title="New rental period"
              description="Choose when the rental starts and who will manage rent and repairs."
              triggerTestId="room-tenancy-create-open"
              testId="tenancy-create-dialog"
              variant="secondary"
            >
              <TenancyCreateForm roomId={roomId} allowProjectManaged={actor.isSystemAdmin} />
            </FormDialog>
          ) : null
        }
      />
      {tenancy ? (
        <section
          aria-label="Selected rental"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface px-5 py-4"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={live ? 'success' : 'neutral'}>
                {tenancy.state === 'CANCELLED'
                  ? 'Cancelled'
                  : !live
                    ? 'Ended'
                    : tenancy.startsAt > now
                      ? 'Scheduled'
                      : 'Active'}
              </Badge>
              <span className="text-small font-medium">
                {tenancy.managementMode === 'PROJECT_MANAGED' ? 'Project managed' : 'Owner managed'}
              </span>
            </div>
            <p className="mt-2 text-small text-muted-foreground">
              {date(tenancy.startsAt)} to {tenancy.endsAt ? date(tenancy.endsAt) : 'No end date'}
            </p>
          </div>
          {periods.length > 1 ? (
            <details className="max-w-full">
              <summary className="cursor-pointer text-small font-medium text-link">
                Change rental period ({periods.length})
              </summary>
              <nav aria-label="Rental periods" className="mt-3 flex max-w-lg flex-wrap gap-2">
                {periods.map((row) => (
                  <Link
                    key={row.id}
                    href={`${base}?view=${view}&tenancyId=${row.id}`}
                    aria-current={row.id === tenancy.id ? 'page' : undefined}
                    className={`${ACTION_LINK_SECONDARY_CLASS} ${row.id === tenancy.id ? 'border-primary bg-nav-active' : ''}`}
                  >
                    {date(row.startsAt)} ·{' '}
                    {row.state === 'CANCELLED'
                      ? 'Cancelled'
                      : row.state !== 'ACTIVE' || (row.endsAt && row.endsAt <= now)
                        ? 'Ended'
                        : row.startsAt > now
                          ? 'Scheduled'
                          : 'Active'}
                  </Link>
                ))}
              </nav>
            </details>
          ) : null}
        </section>
      ) : null}
      {manage ? (
        <section
          data-testid="rental-setup-status"
          aria-label="Rental setup"
          className="rounded-xl border border-border bg-surface px-5 py-4"
        >
          <p className="flex items-center gap-2 text-body font-semibold">
            {!remaining.length ? (
              <Check aria-hidden="true" className="size-4 text-primary" />
            ) : null}
            {remaining.length ? `Next: ${remaining[0]?.label}` : 'Rental setup complete'}
          </p>
          {remaining.length > 0 ? (
            <ol className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {steps.map((step, index) => (
                <li key={step.label} className="flex items-center gap-2 text-small">
                  {step.done ? (
                    <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  ) : (
                    <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <Link
                    href={step.href}
                    className={
                      step.done
                        ? 'text-muted-foreground hover:underline'
                        : 'font-medium text-link hover:underline'
                    }
                  >
                    {index + 1}. {step.label}
                  </Link>
                  <span className="sr-only">{step.done ? 'Complete' : 'Not complete'}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
      <nav aria-label="Rental sections" className="flex min-w-0 gap-1 border-b border-border">
        {[
          { id: 'overview', label: 'Tenants & dates', icon: Users },
          { id: 'payments', label: 'Rent & payments', icon: CreditCard },
          { id: 'maintenance', label: 'Maintenance', icon: Wrench },
        ].map(({ id, label: title, icon: Icon }) => (
          <Link
            key={id}
            href={viewHref(id)}
            data-testid={`rental-nav-${id}`}
            aria-current={view === id ? 'page' : undefined}
            className={`flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-2 py-3 text-center text-small font-medium sm:px-3 xl:flex-none xl:px-5 ${view === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Icon aria-hidden="true" className="hidden size-4 shrink-0 lg:block" />
            {title}
          </Link>
        ))}
      </nav>
      {view === 'overview' ? (
        !tenancy ? (
          <EmptyState
            title="Set up this room's rental"
            description="Start a rental period, add the tenant, then set the monthly rent and receiving account. All rental tasks will stay here."
          />
        ) : (
          <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <SectionCard
              title="Tenants"
              description="People linked to the selected rental period."
              action={
                managePeople ? (
                  <FormDialog
                    triggerLabel="Add tenant"
                    title="Add tenant"
                    triggerTestId="rental-tenant-add-open"
                    testId="tenant-account-dialog"
                    variant="primary"
                  >
                    <RentalTenantForm
                      roomId={roomId}
                      tenancy={tenancy}
                      canCreateAccount={createAccount}
                    />
                  </FormDialog>
                ) : undefined
              }
            >
              {ownMembers.length ? (
                <ul data-testid="rental-tenants" className="divide-y divide-border">
                  {ownMembers.map((member) => (
                    <li
                      key={member.id}
                      className="flex min-w-0 flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-small font-semibold"
                      >
                        {(profiles.get(member.userId) ?? 'A').slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1 basis-28">
                        <p className="break-words text-body font-medium">
                          {profiles.get(member.userId)}
                          <AccountAccessBadge status={accountStates.get(member.userId)} />
                        </p>
                        <p className="mt-1 text-small text-muted-foreground">
                          {member.memberRole === 'MAIN' ? 'Main tenant' : 'Tenant'}
                        </p>
                      </div>
                      {managePeople ? (
                        <EndMembershipButton
                          roomId={roomId}
                          membershipId={member.id}
                          personKind="tenant"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title={
                    live
                      ? 'Add the first tenant'
                      : tenancy.state === 'CANCELLED'
                        ? 'This rental was cancelled'
                        : 'This rental has ended'
                  }
                  description={
                    live
                      ? 'Use an existing account or create sign-in details for someone new.'
                      : 'Tenant access has ended. Previous rent invoices remain in Rent & payments.'
                  }
                />
              )}
              {live && tenancy.startsAt > now ? (
                <p className="mt-4 text-small text-muted-foreground">
                  Link an existing account now. New tenant accounts can be created once the rental
                  starts.
                </p>
              ) : null}
            </SectionCard>
            <SectionCard
              title="Rental agreement"
              description={
                tenancy.managementMode === 'PROJECT_MANAGED'
                  ? 'The project receives rent and handles room repairs.'
                  : 'The room owner receives rent and handles room repairs.'
              }
            >
              <dl className="flex flex-col gap-5 text-body">
                <div>
                  <dt className="text-caption text-muted-foreground">Start date</dt>
                  <dd className="mt-1 font-medium">{date(tenancy.startsAt)}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">End date</dt>
                  <dd className="mt-1 font-medium">
                    {tenancy.endsAt ? date(tenancy.endsAt) : 'No end date'}
                  </dd>
                </div>
              </dl>
              {canEnd ? (
                <details
                  data-testid="rental-period-details"
                  className="mt-5 border-t border-border pt-4"
                >
                  <summary className="cursor-pointer text-small font-medium text-muted-foreground">
                    {tenancy.startsAt > now ? 'Cancel scheduled rental' : 'End rental / move out'}
                  </summary>
                  <p className="my-4 text-small text-muted-foreground">
                    {tenancy.startsAt > now
                      ? 'Cancel this rental before it starts. Planned dates and billing history are kept.'
                      : "End the rental and remove all linked tenants' room access. Invoices and repair history are kept."}
                  </p>
                  <TenancyEndButton
                    roomId={roomId}
                    tenancyId={tenancy.id}
                    scheduled={tenancy.startsAt > now}
                  />
                </details>
              ) : null}
            </SectionCard>
          </div>
        )
      ) : null}
      {view === 'payments' ? (
        !tenancy ? (
          <EmptyState
            title="Start a rental before setting rent"
            description="Open Tenants & dates to create the rental period first."
          />
        ) : (
          <>
            {manage ? (
              <div className="grid min-w-0 items-stretch gap-6 lg:grid-cols-2">
                <SectionCard
                  title="Monthly rent"
                  action={
                    <FormDialog
                      triggerLabel={value ? 'Edit rent' : 'Set monthly rent'}
                      title="Monthly rent"
                      triggerTestId="rent-settings-open"
                      testId="rent-settings-dialog"
                      variant="secondary"
                      icon={value ? 'edit' : 'plus'}
                    >
                      <RentSettingsForm
                        key={value?.id ?? tenancy.id}
                        roomId={roomId}
                        tenancyId={tenancy.id}
                        currentMonth={month}
                        value={value}
                      />
                    </FormDialog>
                  }
                >
                  <p data-testid="rental-rent-amount" className="text-title font-semibold">
                    {value ? `${value.amount} THB / month` : 'Not set'}
                  </p>
                  <p className="mt-2 text-small text-muted-foreground">
                    {value
                      ? `Effective from ${value.effectiveMonth}. Payment is due on the 5th.`
                      : 'Set the amount before creating rent invoices.'}
                  </p>
                </SectionCard>
                <SectionCard
                  title="Receiving account"
                  action={
                    <FormDialog
                      triggerLabel={account ? 'Edit account' : 'Set account'}
                      title={
                        actor.isSystemAdmin
                          ? 'Project receiving account'
                          : 'Private rent receiving account'
                      }
                      description={
                        actor.isSystemAdmin
                          ? 'Changes apply to the shared account for all rooms in the project.'
                          : 'This account is used for private rent in this room.'
                      }
                      triggerTestId="rental-payment-settings"
                      testId="rental-payment-dialog"
                      size="lg"
                      variant="secondary"
                      icon={account ? 'edit' : 'plus'}
                    >
                      <PaymentSettingsForm
                        key={account?.id ?? 'empty'}
                        {...(!actor.isSystemAdmin ? { roomId } : {})}
                        payeeType={actor.isSystemAdmin ? 'PROJECT' : 'OWNER'}
                        value={account}
                      />
                    </FormDialog>
                  }
                >
                  <p className="break-words text-body font-semibold">
                    {account?.bankName ?? 'No receiving account'}
                  </p>
                  {account ? (
                    <p className="mt-1 break-words text-small text-body-secondary">
                      {account.accountName} · {account.accountNumber}
                    </p>
                  ) : null}
                  <p className="mt-3 text-small text-muted-foreground">
                    {actor.isSystemAdmin
                      ? 'Shared project account · All rooms'
                      : 'Private rent account · This room only'}
                  </p>
                </SectionCard>
              </div>
            ) : null}
            <SectionCard
              title="Rent invoices"
              description="Rent invoices for this room, including previous rental periods."
              action={
                manage && readyToBill ? (
                  <FormDialog
                    triggerLabel="Create rent invoice"
                    title="Create rent invoice"
                    description="Choose the billing month. If an invoice already exists, it opens without creating a duplicate."
                    triggerTestId="rent-invoice-open"
                    testId="rent-invoice-dialog"
                    size="sm"
                  >
                    <RentInvoiceForm
                      roomId={roomId}
                      tenancyId={tenancy.id}
                      currentMonth={month}
                      admin={actor.isSystemAdmin}
                    />
                  </FormDialog>
                ) : undefined
              }
            >
              {manage && !readyToBill ? (
                <p className="mb-5 rounded-lg bg-secondary p-4 text-small text-body-secondary">
                  Before creating an invoice:{' '}
                  {remaining.map((step) => step.label.toLowerCase()).join(', ')}.
                </p>
              ) : null}
              {invoices.rows.length ? (
                <>
                  <InvoiceTable
                    tenancyLabels={tenancyLabels}
                    rows={invoices.rows}
                    basePath={actor.isSystemAdmin ? '/admin/billing/invoices' : '/invoices'}
                    caption="Room rent invoices"
                    roomLabels={{ [roomId]: labels[0]?.label ?? room.name }}
                  />
                  <Pagination
                    page={invoicePage}
                    totalPages={Math.ceil(invoices.total / 5)}
                    totalItems={invoices.total}
                    pagePath={base}
                    pageParam="invoicePage"
                    querySuffix={`${selected}&view=payments`}
                  />
                </>
              ) : (
                <EmptyState
                  title="No rent invoices yet"
                  description={
                    actor.isSystemAdmin && kind === 'PRIVATE_RENT'
                      ? 'Private rent invoices are available to the room owner and tenants.'
                      : manage
                        ? 'Invoices will appear here after the rental is set up and the first invoice is created.'
                        : 'Your rent invoices will appear here when issued.'
                  }
                />
              )}
              <Link
                href={
                  actor.isSystemAdmin
                    ? '/admin/billing/turnover-reviews'
                    : '/invoices/turnover-reviews'
                }
                className="mt-5 inline-flex text-small font-medium text-link hover:underline"
              >
                Review a rent cycle with a tenant change
              </Link>
            </SectionCard>
          </>
        )
      ) : null}
      {view === 'maintenance' ? (
        <SectionCard
          title="Room maintenance"
          description={
            current?.managementMode === 'PROJECT_MANAGED'
              ? 'Room problems are sent to the project team.'
              : 'Private room problems are sent to the room owner.'
          }
          action={
            eligible.roomIds.includes(roomId) ? (
              <FormDialog
                triggerLabel="Report a problem"
                title="Report a room problem"
                triggerTestId="rental-maintenance-open"
                testId="rental-maintenance-dialog"
                size="lg"
              >
                <TicketCreateForm
                  privateRooms={current?.managementMode === 'PROJECT_MANAGED' ? [] : [roomOption]}
                  managedRooms={current?.managementMode === 'PROJECT_MANAGED' ? [roomOption] : []}
                  defaultRoomId={roomId}
                  defaultRoutingKind={
                    current?.managementMode === 'PROJECT_MANAGED'
                      ? 'PROJECT_MANAGED_PRIVATE'
                      : 'PRIVATE_OWNER'
                  }
                />
              </FormDialog>
            ) : undefined
          }
        >
          {requests.rows.length ? (
            <>
              <ul data-testid="rental-maintenance-list" className="divide-y divide-border">
                {requests.rows.map((ticket) => (
                  <TicketListCard
                    key={ticket.id}
                    ticket={ticket}
                    roomLabel={roomOption.label}
                    detailHref={
                      actor.isSystemAdmin
                        ? `/admin/maintenance/${ticket.id}`
                        : `/maintenance/${ticket.id}`
                    }
                    testIdPrefix="rental-maintenance"
                    nowIso={now.toISOString()}
                  />
                ))}
              </ul>
              <Pagination
                page={requestPage}
                totalPages={Math.ceil(requests.total / 5)}
                totalItems={requests.total}
                pagePath={base}
                pageParam="requestPage"
                querySuffix={`${selected}&view=maintenance`}
              />
            </>
          ) : (
            <EmptyState
              title="No room repairs to follow up"
              description={
                eligible.roomIds.includes(roomId)
                  ? 'Report a room problem here. You can follow its progress in this list.'
                  : 'Requests you have permission to view will appear here.'
              }
            />
          )}
        </SectionCard>
      ) : null}
    </main>
  );
}
