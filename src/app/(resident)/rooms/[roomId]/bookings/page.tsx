import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { Badge, EmptyState } from '@/shared/ui';
import {
  canActInRoom,
  getRoomDetail,
  getRoomLabels,
} from '@/modules/property-membership/application/index';
import { AppError } from '@/shared/utils/errors';
import { getRoomQuota, getRoomBookingHistory } from '@/modules/facility-booking/application/index';
import { BookingCancelButton } from '@/modules/facility-booking/ui/BookingCancelButton';

function formatInstant(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function slotVariant(state: string): 'success' | 'neutral' | 'danger' {
  if (state === 'CONFIRMED') return 'success';
  if (state === 'ADMIN_CANCELLED') return 'danger';
  return 'neutral';
}

export default async function RoomBookingsPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/rooms');
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/rooms');
  const { roomId } = await params;
  const now = systemClock.now();
  const verdict = await canActInRoom(actor.userId, roomId, 'BOOK_FACILITY', now).catch(() => null);
  if ((verdict === null || !verdict.allowed) && !actor.isSystemAdmin) {
    return (
      <main
        data-testid="room-bookings-page"
        className="mx-auto w-full max-w-[var(--ui-content-wide)] p-4 sm:p-6"
      >
        <EmptyState
          data-testid="room-bookings-forbidden"
          icon={CalendarDays}
          title="Bookings not available"
          description="You do not have booking access to this room, or it does not exist."
        />
      </main>
    );
  }
  const room = await getRoomDetail(roomId).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
    throw error;
  });
  if (room === null) redirect('/rooms');
  const [roomLabel] = await getRoomLabels([roomId]);
  const history = await getRoomBookingHistory(actor, roomId, now);
  const bookings = history.bookings;
  const deletedFacilities = new Set(
    history.facilities.filter((row) => row.deleted).map((row) => row.id),
  );
  const facilityNames = new Map(history.facilities.map((row) => [row.id, row.name]));
  const quotas = [];
  for (const facility of history.facilities.filter((entry) => !entry.deleted)) {
    try {
      quotas.push(await getRoomQuota(actor, facility.id, { roomId }, now));
    } catch {
      continue;
    }
  }
  return (
    <main
      data-testid="room-bookings-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Link
          data-testid="room-bookings-back"
          href={`/rooms/${roomId}`}
          className="inline-flex items-center gap-1.5 self-start rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to room
        </Link>
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            data-testid="room-bookings-title"
            className="break-words text-display leading-display font-semibold tracking-tight text-foreground"
          >
            Bookings · {roomLabel?.label ?? room.name}
          </h1>
          <p className="max-w-2xl text-small leading-small text-muted-foreground">
            Quota is shared by the whole room. Resident cancellations release the seat but keep
            quota used.
          </p>
        </div>
      </div>
      {bookings.length === 0 ? (
        <EmptyState
          data-testid="room-bookings-empty"
          icon={CalendarDays}
          title="No bookings yet"
          description="Book an open slot from the facilities page."
          action={
            <Link
              data-testid="room-bookings-browse"
              href="/facilities"
              className="inline-flex items-center gap-1.5 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Browse facilities
            </Link>
          }
        />
      ) : (
        <ul data-testid="room-bookings-list" className="flex flex-col gap-3">
          {bookings.map((booking) => (
            <li
              key={booking.id}
              className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:p-6"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                {deletedFacilities.has(booking.facilityId) ? (
                  <span
                    data-testid={`room-bookings-facility-${booking.id}`}
                    className="min-w-0 flex-1 break-words text-body font-semibold text-foreground"
                  >
                    {facilityNames.get(booking.facilityId)}
                    <span className="ml-2 text-small font-normal text-muted-foreground">
                      Deleted facility
                    </span>
                  </span>
                ) : (
                  <Link
                    data-testid={`room-bookings-facility-${booking.id}`}
                    href={`/facilities/${booking.facilityId}?roomId=${roomId}`}
                    className="min-w-0 flex-1 basis-40 break-words rounded-md text-body font-semibold text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {facilityNames.get(booking.facilityId) ?? 'Facility'}
                  </Link>
                )}
                <span className="ui-tabular text-small text-muted-foreground">
                  Booked {formatInstant(booking.createdAt)}
                </span>
              </div>
              <ul className="flex flex-col gap-2 border-t border-border pt-3">
                {booking.slots.map((slot) => (
                  <li
                    key={slot.id}
                    data-testid={`room-bookings-slot-${slot.id}`}
                    className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <span className="ui-tabular min-w-0 break-words text-body text-foreground">
                        {formatInstant(slot.startsAt)}
                      </span>
                      <Badge variant={slotVariant(slot.state)}>{slot.state}</Badge>
                    </div>
                    {slot.state === 'CONFIRMED' &&
                    new Date(slot.startsAt).getTime() > now.getTime() ? (
                      <div className="flex flex-wrap gap-2">
                        <BookingCancelButton
                          bookingId={booking.id}
                          slotId={slot.id}
                          startsAt={slot.startsAt}
                          testId={`room-bookings-cancel-${slot.id}`}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {quotas.length > 0 ? (
        <ul
          data-testid="room-bookings-quotas"
          className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
        >
          {quotas.map((quota) => (
            <li
              key={`${quota.facilityId}-${quota.periodKey}`}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-5 py-5"
            >
              <span className="min-w-0 flex-1 basis-40 break-words text-body text-foreground">
                {facilityNames.get(quota.facilityId) ?? 'Facility'}
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge
                  data-testid={`room-bookings-quota-${quota.facilityId}`}
                  variant={quota.quotaUsed >= quota.quotaLimit ? 'warning' : 'info'}
                >
                  {quota.quotaUsed}/{quota.quotaLimit} {quota.quotaKind}
                </Badge>
                <Link
                  data-testid={`room-bookings-book-${quota.facilityId}`}
                  href={`/facilities/${quota.facilityId}?roomId=${roomId}`}
                  className="shrink-0 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  Book slots
                </Link>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
