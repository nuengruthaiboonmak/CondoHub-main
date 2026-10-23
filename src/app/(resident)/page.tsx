import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, CalendarDays, ReceiptText, Wrench } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { decimalStringToSatang, satangToDecimalString } from '@/shared/utils/money';
import { ACTION_LINK_CLASS, Badge, EmptyState, PageHeader, SectionCard, cx } from '@/shared/ui';
import {
  getRoomLabels,
  getTenancyLabels,
  resolveActorRooms,
} from '@/modules/property-membership/application/index';
import { listInvoices } from '@/modules/billing-payments/application/index';
import {
  invoiceStateLabel,
  invoiceStateVariant,
  kindLabel,
} from '@/modules/billing-payments/ui/billingLabels';
import { listTickets } from '@/modules/maintenance/application/index';
import { formatInstant, isTerminalTicketStatus } from '@/modules/maintenance/ui/ticketLabels';
import { listFacilityPage, listRoomBookings } from '@/modules/facility-booking/application/index';
import { AnnouncementPreview } from '@/modules/announcements/ui/AnnouncementPreview';
import { listAnnouncementFeed } from '@/modules/announcements/application/index';
import { countUnresolvedTurnoverReviews } from '@/modules/billing-payments/application/index';

export const dynamic = 'force-dynamic';

function dueText(dueDate: string, now: Date): string {
  const due = new Date(`${dueDate}T00:00:00+07:00`);
  const days = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (Number.isNaN(days)) return `due ${dueDate}`;
  if (days < 0) return `overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
  if (days === 0) return 'due today';
  return `due in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export default async function HomePage() {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/');
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/');
  if (actor.isSystemAdmin) redirect('/admin/buildings');
  const now = systemClock.now();
  const [rooms, invoices, tickets, announcements, facilities, receivables] = await Promise.all([
    resolveActorRooms(actor, now),
    listInvoices(actor, { page: 1, pageSize: 100, view: 'payable', at: now }),
    listTickets(actor, { page: 1, pageSize: 4, view: 'open' }),
    listAnnouncementFeed(actor, { page: 1, pageSize: 3 }, now),
    listFacilityPage(actor, { status: 'ACTIVE', page: 1, pageSize: 100 }),
    listInvoices(actor, { page: 1, pageSize: 4, view: 'receivable', at: now }),
  ]);
  let turnoverUnresolved = 0;
  try {
    turnoverUnresolved = await countUnresolvedTurnoverReviews(actor);
  } catch {
    turnoverUnresolved = 0;
  }
  const bookingsByRoom = await Promise.all(
    rooms.map((room) => listRoomBookings(actor, { roomId: room.id }, now).catch(() => [])),
  );
  const upcoming = bookingsByRoom
    .flatMap((bookings, index) =>
      bookings.flatMap((booking) =>
        booking.slots
          .filter((slot) => slot.state === 'CONFIRMED' && slot.startsAt > now.toISOString())
          .map((slot) => ({
            roomCode: rooms[index]?.name ?? '',
            roomId: rooms[index]?.id ?? '',
            facilityId: booking.facilityId,
            startsAt: slot.startsAt,
          })),
      ),
    )
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
    .slice(0, 4);
  const facilityNames = new Map(facilities.rows.map((facility) => [facility.id, facility.name]));
  const roomCodes = new Map(rooms.map((room) => [room.id, room.name]));
  const rentRoomLabels = new Map(
    (await getRoomLabels([...new Set(receivables.rows.map((row) => row.roomId))])).map((room) => [
      room.id,
      room.label,
    ]),
  );
  const owedInvoices = invoices.rows.filter(
    (row) => decimalStringToSatang(row.outstanding.amount) > 0n,
  );
  const tenancyLabels = await getTenancyLabels(
    receivables.rows.flatMap((row) => (row.tenancyId ? [row.tenancyId] : [])),
  );
  const urgentInvoice = [...owedInvoices].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.dueDate < b.dueDate ? -1 : 1;
  })[0];
  const openTickets = tickets.rows.filter((row) => !isTerminalTicketStatus(row.status));
  const latestAnnouncement = announcements.rows[0] ?? null;
  return (
    <main
      data-testid="home-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-6 px-4 py-6 sm:px-6"
    >
      <PageHeader title="Home" description="What needs attention across your rooms." />
      {urgentInvoice !== undefined ? (
        <section
          data-testid="home-hero"
          aria-label="Most urgent bill"
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:p-7"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-small text-muted-foreground">
              Most urgent bill
              {owedInvoices.length > 1 ? ` · plus ${owedInvoices.length - 1} more unpaid` : ''}
            </p>
            <p
              data-testid="home-owed-total"
              className="ui-tabular text-display font-semibold tracking-tight text-foreground"
            >
              {satangToDecimalString(decimalStringToSatang(urgentInvoice.outstanding.amount))} THB
            </p>
            <p className="text-small text-muted-foreground">
              {kindLabel(urgentInvoice.kind)} · {urgentInvoice.periodStart} ·{' '}
              {dueText(urgentInvoice.dueDate, now)}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              data-testid="home-hero-action"
              href={`/invoices/${urgentInvoice.id}`}
              className={cx(ACTION_LINK_CLASS, 'w-full sm:w-fit')}
            >
              <ReceiptText aria-hidden="true" className="size-5" />
              View invoice
            </Link>
            {owedInvoices.length > 1 ? (
              <Link
                data-testid="home-hero-all-bills"
                href="/invoices"
                className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-2 text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring sm:justify-start"
              >
                View all bills
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
      {receivables.total > 0 ? (
        <SectionCard
          testId="home-rent-collection"
          title="Rent to collect"
          description="Your latest rent invoices and tenant payments."
          action={
            <Link
              data-testid="home-rent-collection-all"
              href="/invoices?view=receivable"
              className="inline-flex items-center gap-1 rounded-md text-body font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Review rent
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        >
          <ul className="flex min-w-0 flex-col divide-y divide-border">
            {receivables.rows.map((row) => (
              <li key={row.id}>
                <Link
                  data-testid={`home-rent-invoice-${row.id}`}
                  href={`/invoices/${row.id}`}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-body font-medium text-link">
                      Rent · {row.periodStart}
                    </span>
                    <span className="truncate text-small text-muted-foreground">
                      {rentRoomLabels.get(row.roomId) ?? 'Room'}
                    </span>
                    {row.tenancyId && tenancyLabels[row.tenancyId] ? (
                      <span className="text-small text-body-secondary">
                        Rental period: {tenancyLabels[row.tenancyId]}
                      </span>
                    ) : null}
                    <span className="ui-tabular text-small text-body-secondary">
                      {row.outstanding.amount} THB outstanding
                    </span>
                  </span>
                  <Badge variant={invoiceStateVariant(row.state)}>
                    {invoiceStateLabel(row.state)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
      {turnoverUnresolved > 0 ? (
        <section
          aria-label="Turnover reviews"
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 sm:p-7"
        >
          <Link
            data-testid="nav-turnover-reviews-badge"
            href="/invoices/turnover-reviews?state=UNRESOLVED"
            className="inline-flex min-w-0 items-center gap-2 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <Badge data-testid="turnover-unresolved-badge" variant="warning">
              {turnoverUnresolved} unresolved turnover{' '}
              {turnoverUnresolved === 1 ? 'review' : 'reviews'}
            </Badge>
          </Link>
          <p className="text-small text-muted-foreground">
            Review each request and choose to approve or resolve it.
          </p>
        </section>
      ) : null}
      {urgentInvoice === undefined &&
      turnoverUnresolved === 0 &&
      rooms.length === 0 &&
      receivables.total === 0 ? (
        <EmptyState
          data-testid="home-empty"
          title="No rooms yet"
          description="When you join or own a room, tasks for it appear here."
        />
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title={`Open requests (${tickets.total})`}
          description="Track the issues you have reported."
          action={
            <Link
              data-testid="home-requests-all"
              href="/maintenance"
              className="inline-flex shrink-0 items-center gap-1 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              View all
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        >
          {openTickets.length === 0 ? (
            <p data-testid="home-requests-empty" className="text-small text-muted-foreground">
              No open requests. Report an issue to start one.
            </p>
          ) : (
            <ul
              data-testid="home-requests-list"
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              {openTickets.slice(0, 3).map((ticket, index) => (
                <li
                  key={ticket.id}
                  className={
                    index === Math.min(openTickets.length, 3) - 1
                      ? undefined
                      : 'border-b border-border'
                  }
                >
                  <Link
                    data-testid={`home-request-${ticket.id}`}
                    href={`/maintenance/${ticket.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-[background-color] duration-150 ease-out hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring motion-reduce:transition-none"
                  >
                    <Wrench aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body font-medium text-foreground">
                        {ticket.subject}
                      </span>
                      <span className="truncate text-small text-muted-foreground">
                        {ticket.roomId !== null
                          ? `${roomCodes.get(ticket.roomId) ?? 'Room'} · `
                          : 'Common area · '}
                        {formatInstant(ticket.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard
          title={'Upcoming bookings'}
          description="Your next reservations across shared spaces."
          action={
            <Link
              data-testid="home-bookings-browse"
              href="/facilities"
              className="inline-flex shrink-0 items-center gap-1 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Book a facility
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <p data-testid="home-bookings-empty" className="text-small text-muted-foreground">
              No upcoming bookings. Pick a facility to reserve a slot.
            </p>
          ) : (
            <ul
              data-testid="home-bookings-list"
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              {upcoming.map((booking, index) => (
                <li
                  key={`${booking.roomId}-${booking.facilityId}-${booking.startsAt}`}
                  className={index === upcoming.length - 1 ? undefined : 'border-b border-border'}
                >
                  <Link
                    href={`/rooms/${booking.roomId}/bookings`}
                    className="flex items-center gap-3 px-4 py-3 transition-[background-color] duration-150 ease-out hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring motion-reduce:transition-none"
                  >
                    <CalendarDays
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body font-medium text-foreground">
                        {facilityNames.get(booking.facilityId) ?? 'Facility'}
                      </span>
                      <span className="truncate text-small text-muted-foreground">
                        {booking.roomCode} · {formatInstant(booking.startsAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      <section aria-label="Latest announcement" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-heading font-semibold text-foreground">Community updates</h2>
          <Link
            data-testid="home-announcements-all"
            href="/announcements"
            className="inline-flex shrink-0 items-center gap-1 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            View all
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        {latestAnnouncement === null ? (
          <p data-testid="home-announcement-empty" className="text-small text-muted-foreground">
            No announcements published yet.
          </p>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-3">
            {announcements.rows.map((announcement, index) => (
              <AnnouncementPreview
                key={announcement.id}
                announcement={announcement}
                linkTestId={
                  index === 0 ? 'home-announcement-latest' : `home-announcement-${announcement.id}`
                }
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
