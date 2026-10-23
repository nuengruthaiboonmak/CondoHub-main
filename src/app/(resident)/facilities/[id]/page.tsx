import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ArrowLeft, CalendarDays, Settings2 } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import {
  ACTION_LINK_SECONDARY_CLASS,
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
} from '@/shared/ui';
import {
  getActiveResidentRooms,
  getRoomLabels,
} from '@/modules/property-membership/application/index';
import { getFacilityDetail, listRoomBookings } from '@/modules/facility-booking/application/index';
import { OpeningHours } from '@/modules/facility-booking/ui/OpeningHours';
import { SlotPicker } from '@/modules/facility-booking/ui/SlotPicker';

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

function quotaWindow(kind: string): string {
  if (kind === 'WEEKLY') return 'week';
  if (kind === 'MONTHLY') return 'month';
  return 'day';
}

export default async function ResidentFacilityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ roomId?: string; date?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/facilities');
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/facilities');
  const { id } = await params;
  const query = await searchParams;
  const now = systemClock.now();
  const detail = await getFacilityDetail(actor, id, now);
  if (detail === null || detail.status !== 'ACTIVE') {
    return (
      <main
        data-testid="facility-detail-page"
        className="mx-auto w-full max-w-[var(--ui-content-wide)] p-4 sm:p-6"
      >
        <EmptyState
          data-testid="facility-detail-missing"
          icon={CalendarDays}
          title="Facility not available"
          description="This facility does not exist or is not open for booking."
          action={
            <Link
              data-testid="facility-detail-back"
              href="/facilities"
              className="inline-flex items-center gap-1.5 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to facilities
            </Link>
          }
        />
      </main>
    );
  }
  const jar = await cookies();
  const lastRoomId = jar.get('lastRoomId')?.value ?? null;
  const roomIds = await getActiveResidentRooms(actor.userId, now);
  const rooms = (await getRoomLabels(roomIds)).map((room) => ({
    id: room.id,
    name: room.name,
    buildingName: room.buildingName,
  }));
  const initialRoomId =
    (query.roomId !== undefined && rooms.some((room) => room.id === query.roomId)
      ? query.roomId
      : null) ??
    (lastRoomId !== null && rooms.some((room) => room.id === lastRoomId) ? lastRoomId : null) ??
    rooms[0]?.id ??
    null;
  let upcoming: Array<{ id: string; startsAt: string }> = [];
  if (initialRoomId !== null) {
    try {
      const bookings = await listRoomBookings(actor, { roomId: initialRoomId }, now);
      upcoming = bookings
        .filter((booking) => booking.facilityId === detail.id)
        .flatMap((booking) =>
          booking.slots
            .filter((slot) => slot.state === 'CONFIRMED' && slot.startsAt > now.toISOString())
            .map((slot) => ({ id: slot.id, startsAt: slot.startsAt })),
        )
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    } catch {
      upcoming = [];
    }
  }
  const config = detail.effectiveConfig;
  const selectedRoom = rooms.find((room) => room.id === initialRoomId);
  return (
    <main
      data-testid="facility-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <div data-testid="facility-detail-title">
        <PageHeader
          title={detail.name}
          descriptionTestId="facility-detail-description"
          description={detail.description ?? 'Reserve time in this shared space.'}
          backHref="/facilities"
          backLabel="Back to facilities"
          backTestId="facility-detail-back"
          actions={
            <>
              <Badge variant="success">Open for booking</Badge>
              {actor.isSystemAdmin ? (
                <Link
                  href={`/admin/facilities/${detail.id}`}
                  className={ACTION_LINK_SECONDARY_CLASS}
                >
                  <Settings2 className="size-4" aria-hidden="true" />
                  Manage facility
                </Link>
              ) : null}
            </>
          }
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <SectionCard
            title="Book a time"
            description="Choose your room and date, then select available time slots."
          >
            {rooms.length === 0 ? (
              <EmptyState
                data-testid="facility-detail-no-rooms"
                icon={CalendarDays}
                title="No room access yet"
                description="Bookings are available to active residents. Contact your property team if your room is missing."
              />
            ) : (
              <SlotPicker
                facilityId={detail.id}
                rooms={rooms}
                initialRoomId={initialRoomId}
                initialDate={query.date}
              />
            )}
          </SectionCard>
          {initialRoomId !== null ? (
            <SectionCard
              title="Upcoming bookings"
              description={`Reservations for ${selectedRoom?.name ?? 'your room'} at this facility.`}
              action={
                <Link
                  data-testid="facility-detail-bookings-link"
                  href={`/rooms/${initialRoomId}/bookings`}
                  className="text-small font-medium text-link hover:underline"
                >
                  View all bookings
                </Link>
              }
            >
              {upcoming.length > 0 ? (
                <ul
                  data-testid="facility-detail-bookings"
                  className="flex min-w-0 flex-col divide-y divide-border"
                >
                  {upcoming.map((slot) => (
                    <li
                      key={slot.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <span className="ui-tabular text-body">{formatInstant(slot.startsAt)}</span>
                      <Badge variant="success">Confirmed</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-muted-foreground">No upcoming bookings here.</p>
              )}
            </SectionCard>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <SectionCard title="Booking details">
            <dl className="flex flex-col gap-5 text-body">
              <div>
                <dt className="text-caption text-muted-foreground">Capacity per time slot</dt>
                <dd className="mt-1 font-medium">
                  {detail.capacity} {detail.capacity === 1 ? 'space' : 'spaces'}
                </dd>
              </div>
              {config ? (
                <>
                  <div>
                    <dt className="text-caption text-muted-foreground">Time per slot</dt>
                    <dd className="mt-1 font-medium">{config.slotMinutes} minutes</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">Room allowance</dt>
                    <dd className="mt-1 font-medium">
                      {config.quotaLimit} bookings per {quotaWindow(config.quotaKind)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">Book ahead</dt>
                    <dd className="mt-1 font-medium">Up to {config.advanceDays} days</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </SectionCard>
          {config ? (
            <SectionCard title="Opening hours">
              <OpeningHours schedule={config.schedule} />
            </SectionCard>
          ) : null}
        </div>
      </div>
    </main>
  );
}
