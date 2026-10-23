import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { PROJECT_TIMEZONE } from '@/config/project';
import {
  ActionMenu,
  ResourceStatusControl,
  Badge,
  EmptyState,
  FormDialog,
  PageHeader,
  Pagination,
  SectionCard,
} from '@/shared/ui';
import {
  getFacilityDetail,
  listFacilityBookings,
} from '@/modules/facility-booking/application/index';
import { getRoomLabels } from '@/modules/property-membership/application/index';
import { OpeningHours } from '@/modules/facility-booking/ui/OpeningHours';
import { FacilityDeleteControl } from '@/modules/facility-booking/ui/FacilityDeleteControl';
import { FacilityEditForm } from '@/modules/facility-booking/ui/FacilityEditForm';
import { ClosureCreateForm } from '@/modules/facility-booking/ui/ClosureCreateForm';
import { ConfigChangeForm } from '@/modules/facility-booking/ui/ConfigChangeForm';
import { BookingCancelButton } from '@/modules/facility-booking/ui/BookingCancelButton';

const formatInstant = (value: string | Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: PROJECT_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const QUOTA_PERIODS = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' };

export default async function AdminFacilityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/facilities');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const { id } = await params;
  const query = await searchParams;
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const detail = await getFacilityDetail(actor, id, systemClock.now());
  if (!detail) redirect('/admin/facilities');
  const feed = await listFacilityBookings(actor, { facilityId: id, page, pageSize: 10 });
  const roomNames = new Map(
    (await getRoomLabels([...new Set(feed.rows.map((row) => row.booking.roomId))])).map((room) => [
      room.id,
      room.label,
    ]),
  );
  const config = detail.effectiveConfig;
  const openDays = config
    ? (Object.keys(config.schedule.days) as Array<'0' | '1' | '2' | '3' | '4' | '5' | '6'>).filter(
        (day) => config.schedule.days[day].open.length > 0,
      )
    : [];
  const firstOpen = config && openDays[0] ? config.schedule.days[openDays[0]].open[0] : undefined;
  return (
    <main
      data-testid="admin-facility-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title={detail.name}
        titleTestId="admin-facility-detail-title"
        descriptionTestId="admin-facility-detail-description"
        description={
          detail.description ??
          'Manage availability, booking rules, and reservations for this shared space.'
        }
        backHref="/admin/facilities"
        backLabel="Back to facilities"
        actions={
          <>
            <Badge variant={detail.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {detail.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </Badge>
            <ActionMenu label="Facility actions" testId="facility-actions">
              <FormDialog
                icon="edit"
                triggerLabel="Edit facility"
                title="Edit facility"
                description="Update the information residents see."
                triggerTestId="facility-edit-open"
                testId="facility-edit-dialog"
                variant="secondary"
              >
                <FacilityEditForm
                  facilityId={detail.id}
                  initial={{
                    name: detail.name,
                    description: detail.description,
                    status: detail.status,
                    capacity: detail.capacity,
                  }}
                />
              </FormDialog>
              <ResourceStatusControl
                resource="facility"
                active={detail.status === 'ACTIVE'}
                endpoint={`/api/admin/facilities/${detail.id}`}
                testId="facility-status"
                description="An inactive facility stops accepting new bookings. Existing bookings and history stay recorded."
              />
              <FacilityDeleteControl facilityId={detail.id} name={detail.name} />
            </ActionMenu>
            <Link
              href={`/facilities/${detail.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-small font-medium text-link"
            >
              Resident view
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          </>
        }
      />
      <SectionCard
        title="Booking rules"
        description="The current rules residents use to reserve this facility."
        action={
          config ? (
            <FormDialog
              icon="edit"
              triggerLabel="Change booking rules"
              title="Change booking rules"
              description="Preview the impact before confirming changes."
              triggerTestId="config-change-open"
              testId="config-change-dialog"
              size="lg"
              variant="secondary"
            >
              <ConfigChangeForm
                facilityId={detail.id}
                capacity={detail.capacity}
                initial={{
                  slotMinutes: config.slotMinutes,
                  quotaKind: config.quotaKind,
                  quotaLimit: config.quotaLimit,
                  advanceDays: config.advanceDays,
                  openStart: firstOpen?.start ?? '09:00',
                  openEnd: firstOpen?.end ?? '18:00',
                  openDays,
                  schedule: config.schedule,
                }}
              />
            </FormDialog>
          ) : null
        }
      >
        {!config ? (
          <p data-testid="admin-facility-no-config" className="text-body text-muted-foreground">
            No effective configuration.
          </p>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-7 lg:grid-cols-2">
            <div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-6 text-body">
                <div>
                  <dt className="text-caption text-muted-foreground">Slot duration</dt>
                  <dd className="mt-1 font-semibold">{config.slotMinutes} minutes</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Capacity per slot</dt>
                  <dd className="mt-1 font-semibold">
                    {detail.capacity} {detail.capacity === 1 ? 'space' : 'spaces'}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Quota per room</dt>
                  <dd className="mt-1 font-semibold">
                    {config.quotaLimit} bookings / {QUOTA_PERIODS[config.quotaKind]}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted-foreground">Booking window</dt>
                  <dd className="mt-1 font-semibold">{config.advanceDays} days ahead</dd>
                </div>
              </dl>
              <p className="mt-6 text-caption text-muted-foreground">
                Effective {formatInstant(config.effectiveAt)}
              </p>
            </div>
            <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
              <h3 className="mb-3 text-small font-semibold">Opening hours</h3>
              <OpeningHours schedule={config.schedule} />
            </div>
          </div>
        )}
        {detail.pendingConfig ? (
          <div
            data-testid="admin-facility-pending"
            className="mt-5 rounded-lg border border-info-border bg-info p-3 text-small text-info-foreground"
          >
            A new set of booking rules takes effect{' '}
            {formatInstant(detail.pendingConfig.effectiveAt)}.
          </div>
        ) : null}
      </SectionCard>
      <SectionCard
        title={`Closures (${detail.closures.length})`}
        description="Times when this facility is temporarily unavailable."
        action={
          <FormDialog
            triggerLabel="Add closure"
            title="Add closure"
            description="Choose when this facility will be unavailable."
            triggerTestId="closure-create-open"
            testId="closure-create-dialog"
            variant="secondary"
          >
            <ClosureCreateForm facilityId={detail.id} />
          </FormDialog>
        }
      >
        {detail.closures.length === 0 ? (
          <p data-testid="admin-facility-no-closures" className="text-body text-muted-foreground">
            No closures recorded.
          </p>
        ) : (
          <ul
            data-testid="admin-facility-closures"
            className="flex flex-col divide-y divide-border"
          >
            {detail.closures.map((closure) => (
              <li
                key={closure.id}
                className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0"
              >
                <p className="break-words text-body font-medium">
                  {formatInstant(closure.startsAt)} to {formatInstant(closure.endsAt)}
                </p>
                <p className="break-words text-small text-muted-foreground">{closure.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard
        title={`Bookings (${feed.total})`}
        description="Reservations and their current status."
      >
        {feed.rows.length === 0 ? (
          <EmptyState
            data-testid="admin-facility-no-bookings"
            title="No bookings yet"
            description="Reservations will appear here when residents book this facility."
          />
        ) : (
          <ul data-testid="admin-facility-bookings" className="flex flex-col gap-6">
            {feed.rows.map(({ booking, slots }) => (
              <li key={booking.id} className="min-w-0">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="break-words text-body font-semibold">
                    {roomNames.get(booking.roomId) ?? 'Room unavailable'}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    Booked {formatInstant(booking.createdAt)}
                  </p>
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {slots.map((slot) => (
                    <li
                      key={slot.id}
                      data-testid={`admin-facility-slot-${slot.id}`}
                      className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 flex-1 basis-40 text-body">
                        {formatInstant(slot.startsAt)}
                      </span>
                      <Badge
                        variant={
                          slot.state === 'CONFIRMED'
                            ? 'success'
                            : slot.state === 'ADMIN_CANCELLED'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {slot.state}
                      </Badge>
                      {slot.state === 'CONFIRMED' ? (
                        <BookingCancelButton
                          bookingId={booking.id}
                          slotId={slot.id}
                          startsAt={slot.startsAt.toISOString()}
                          testId={`admin-facility-cancel-${slot.id}`}
                          admin
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5">
          <Pagination
            page={page}
            totalPages={Math.ceil(feed.total / 10)}
            totalItems={feed.total}
            pagePath={`/admin/facilities/${id}`}
            testId="admin-facility-booking-pages"
          />
        </div>
      </SectionCard>
    </main>
  );
}
