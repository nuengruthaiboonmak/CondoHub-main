import 'server-only';
import { AccountAccessBadge } from '@/modules/identity-access/ui/AccountAccessBadge';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, CalendarDays, KeyRound, MessageCircle } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { PROJECT_TIMEZONE } from '@/config/project';
import {
  ActionMenu,
  ACTION_LINK_CLASS,
  ACTION_LINK_SECONDARY_CLASS,
  Badge,
  EmptyState,
  FormDialog,
  PageHeader,
  SectionCard,
} from '@/shared/ui';
import {
  canActInRoom,
  getCurrentOwners,
  getRoomDetail,
  getRoomLabels,
  listCurrentRoomMemberships,
  listRoomTenancies,
} from '@/modules/property-membership/application/index';
import { getPeopleProfiles } from '@/modules/identity-access/application/index';
import { RoomMemberAddForm } from '@/modules/property-membership/ui/RoomMemberAddForm';
import {
  OwnershipAssignForm,
  OwnershipManageForm,
} from '@/modules/property-membership/ui/OwnershipForms';
import { RoomRowActions } from '@/modules/property-membership/ui/RoomRowActions';
import { EndMembershipButton } from '@/modules/property-membership/ui/EndMembershipButton';

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: PROJECT_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);

export default async function RoomDetailPage({ params }: { params: Promise<{ roomId: string }> }) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/rooms');
  if (actor.mustChangePassword) redirect('/change-password');
  const { roomId } = await params;
  const now = systemClock.now();
  const verdict = await canActInRoom(actor.userId, roomId, 'VIEW_ROOM', now).catch(() => null);
  if ((!verdict || !verdict.allowed) && !actor.isSystemAdmin)
    return (
      <main data-testid="room-detail-page" className="p-6">
        <EmptyState
          data-testid="room-detail-forbidden"
          title="Room not available"
          description="You do not have access to this room, or it does not exist."
        />
      </main>
    );
  const room = await getRoomDetail(roomId).catch(() => null);
  if (!room) redirect('/rooms');
  const [labels, owners, memberships, tenancies, manageVerdict] = await Promise.all([
    getRoomLabels([roomId]),
    getCurrentOwners(roomId, now),
    listCurrentRoomMemberships(roomId, now),
    listRoomTenancies(roomId),
    canActInRoom(actor.userId, roomId, 'MANAGE_MEMBERS', now).catch(() => null),
  ]);
  const label = labels[0];
  const canUseResidentServices =
    actor.isSystemAdmin || (await canActInRoom(actor.userId, roomId, 'VIEW_CHAT', now)).allowed;
  const isRoomOwner = owners.some((owner) => owner.userId === actor.userId);
  const canManageMembers = actor.isSystemAdmin || manageVerdict?.allowed === true;
  const activeTenancies = tenancies.filter(
    (tenancy) => tenancy.state === 'ACTIVE' && (!tenancy.endsAt || tenancy.endsAt > now),
  );
  const currentTenancy = activeTenancies.find((row) => row.startsAt <= now);
  const upcomingTenancy = activeTenancies.find((row) => row.startsAt > now);
  const rental = currentTenancy ?? upcomingTenancy;
  const canAddHousehold = canManageMembers && activeTenancies.length === 0;
  const people = await getPeopleProfiles(
    [...owners, ...memberships].map((person) => person.userId),
  );
  const profiles = new Map(people.map((person) => [person.userId, person.name]));
  const accountStates = new Map(people.map((person) => [person.userId, person.status]));
  return (
    <main
      data-testid="room-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <div data-testid="room-detail-title">
        <PageHeader
          title={room.name}
          description={`${label?.buildingName ?? 'Building'} · ${label?.floorLabel ?? 'Floor'} · ${room.areaSqm} sqm`}
          backHref="/rooms"
          backLabel="Back to Rooms"
          backTestId="room-detail-back"
          actions={
            <>
              {canUseResidentServices ? (
                <Link
                  data-testid="room-detail-bookings-link"
                  href={`/rooms/${room.id}/bookings`}
                  className={ACTION_LINK_SECONDARY_CLASS}
                >
                  <CalendarDays aria-hidden="true" className="size-4" />
                  View bookings
                </Link>
              ) : null}
              {canUseResidentServices ? (
                <Link
                  data-testid="room-detail-chat-link"
                  href={
                    actor.isSystemAdmin ? `/admin/rooms/${room.id}/chat` : `/rooms/${room.id}/chat`
                  }
                  className={ACTION_LINK_CLASS}
                >
                  <MessageCircle aria-hidden="true" className="size-4" />
                  Open room chat
                </Link>
              ) : null}
              {actor.isSystemAdmin ? (
                <ActionMenu label="Room actions" testId="room-actions">
                  <RoomRowActions
                    roomId={room.id}
                    name={room.name}
                    areaSqm={room.areaSqm}
                    status={room.status}
                    deleteRedirectTo="/rooms"
                  />
                </ActionMenu>
              ) : null}
            </>
          }
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section
            aria-label="Rental overview"
            className="rounded-xl border border-border bg-surface p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                  <KeyRound aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h2 className="text-heading font-semibold">
                    {currentTenancy
                      ? 'Active rental'
                      : upcomingTenancy
                        ? 'Rental scheduled'
                        : 'No active rental'}
                  </h2>
                  <p className="mt-1 text-small text-muted-foreground">
                    {rental
                      ? rental.managementMode === 'PROJECT_MANAGED'
                        ? 'Managed by the project'
                        : 'Managed by the room owner'
                      : 'Manage tenants, rent, payments, and repairs in one place.'}
                  </p>
                </div>
              </div>
              <Badge variant={currentTenancy ? 'success' : 'neutral'}>
                {currentTenancy ? 'Active' : upcomingTenancy ? 'Scheduled' : 'Not rented'}
              </Badge>
            </div>
            {rental ? (
              <p className="mt-5 text-body text-body-secondary">
                {formatDate(rental.startsAt)} to{' '}
                {rental.endsAt ? formatDate(rental.endsAt) : 'No end date'}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
              <p className="max-w-md text-small text-muted-foreground">
                {actor.isSystemAdmin || isRoomOwner
                  ? 'Add tenants, set rent, and follow up on payments and room maintenance.'
                  : 'Find your rent invoices and report a room problem.'}
              </p>
              <Link
                data-testid="room-rental-link"
                href={`/rooms/${room.id}/rental`}
                className={ACTION_LINK_CLASS}
              >
                {actor.isSystemAdmin || isRoomOwner ? 'Manage rental' : 'View rental'}
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </section>
          <SectionCard
            title="Owners"
            description="People who hold current ownership of this room."
            action={
              actor.isSystemAdmin || isRoomOwner ? (
                <FormDialog
                  triggerLabel={actor.isSystemAdmin ? 'Assign owner' : 'Add co-owner'}
                  title={actor.isSystemAdmin ? 'Assign owner' : 'Add co-owner'}
                  description={`Assign an existing account as an owner of ${room.name}.`}
                  triggerTestId="ownership-assign-open"
                  testId="ownership-assign-dialog"
                  variant="secondary"
                >
                  <OwnershipAssignForm
                    roomId={room.id}
                    mode={actor.isSystemAdmin ? 'assign' : 'co-owner'}
                  />
                </FormDialog>
              ) : null
            }
          >
            {owners.length === 0 ? (
              <p data-testid="room-owners-empty" className="text-body text-muted-foreground">
                No owners assigned.
              </p>
            ) : (
              <ul data-testid="room-owners-list" className="flex flex-col divide-y divide-border">
                {owners.map((owner) => (
                  <li
                    key={owner.ownershipId}
                    className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-small font-semibold"
                    >
                      {(profiles.get(owner.userId) ?? 'A').slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-body font-medium">
                        {profiles.get(owner.userId)}
                        <AccountAccessBadge status={accountStates.get(owner.userId)} />
                      </p>
                      <p className="text-caption text-muted-foreground">
                        Since {formatDate(owner.startAt)}
                      </p>
                    </div>
                    <Badge variant="neutral">Owner</Badge>
                  </li>
                ))}
              </ul>
            )}
            {actor.isSystemAdmin && owners.length > 0 ? (
              <details className="mt-5 border-t border-border pt-4">
                <summary className="cursor-pointer text-small font-medium text-link">
                  More ownership actions
                </summary>
                <div className="mt-4">
                  <OwnershipManageForm
                    roomId={room.id}
                    owners={owners.map((owner) => ({
                      ownershipId: owner.ownershipId,
                      userId: owner.userId,
                      name: profiles.get(owner.userId) ?? 'Account unavailable',
                    }))}
                  />
                </div>
              </details>
            ) : null}
          </SectionCard>
          <SectionCard
            title={`People in this room (${memberships.length})`}
            description={
              currentTenancy
                ? 'Current residents. Tenant access is managed in Rental management.'
                : 'Household members with current access to this room.'
            }
            action={
              canAddHousehold ? (
                <FormDialog
                  triggerLabel="Add member"
                  title="Add member"
                  description="Give an existing account access to this room."
                  triggerTestId="room-member-add-open"
                  testId="room-member-add-dialog"
                  variant="secondary"
                >
                  <RoomMemberAddForm
                    roomId={room.id}
                    activeTenancies={activeTenancies.map((tenancy) => ({
                      id: tenancy.id,
                      managementMode: tenancy.managementMode,
                    }))}
                  />
                </FormDialog>
              ) : null
            }
          >
            {memberships.length === 0 ? (
              <p data-testid="room-memberships-empty" className="text-body text-muted-foreground">
                No active members.
              </p>
            ) : (
              <ul
                data-testid="room-memberships-list"
                className="flex flex-col divide-y divide-border"
              >
                {memberships.map((membership) => (
                  <li
                    key={membership.id}
                    className="flex min-w-0 flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-small font-semibold"
                    >
                      {(profiles.get(membership.userId) ?? 'A').slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1 basis-28">
                      <p className="break-words text-body font-medium">
                        {profiles.get(membership.userId)}
                        <AccountAccessBadge status={accountStates.get(membership.userId)} />
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {membership.tenancyId
                          ? membership.memberRole === 'MAIN'
                            ? 'Main tenant'
                            : 'Tenant'
                          : membership.memberRole === 'MAIN'
                            ? 'Main member'
                            : 'Member'}
                      </p>
                    </div>
                    {canManageMembers && !membership.tenancyId ? (
                      <EndMembershipButton roomId={room.id} membershipId={membership.id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
        <SectionCard title="Room details">
          <dl className="flex flex-col gap-5 text-body">
            <div>
              <dt className="text-caption text-muted-foreground">Building</dt>
              <dd className="mt-1 break-words font-medium">{label?.buildingName ?? 'Building'}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Floor</dt>
              <dd className="mt-1 font-medium">{label?.floorLabel ?? 'Floor'}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Area</dt>
              <dd className="mt-1 font-medium">{room.areaSqm} sqm</dd>
            </div>
            <div>
              <dt className="mb-2 text-caption text-muted-foreground">Status</dt>
              <dd>
                <Badge variant={room.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {room.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </Badge>
              </dd>
            </div>
          </dl>
          <Link
            data-testid="room-detail-facilities-link"
            href="/facilities"
            className="mt-6 inline-flex text-small font-medium text-link hover:underline"
          >
            Browse facilities
          </Link>
        </SectionCard>
      </div>
    </main>
  );
}
