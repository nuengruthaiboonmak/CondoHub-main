import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { PageHeader, SectionCard } from '@/shared/ui';
import { listEligibleRooms } from '@/modules/maintenance/application/index';
import { TicketCreateForm } from '@/modules/maintenance/ui/TicketCreateForm';
import { getRoomLabels } from '@/modules/property-membership/application/index';

export const dynamic = 'force-dynamic';

export default async function MaintenanceNewPage() {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/maintenance/new');
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/maintenance/new');
  const now = systemClock.now();
  const [privateScope, managedScope] = await Promise.all([
    listEligibleRooms(actor, 'PRIVATE_OWNER', now),
    listEligibleRooms(actor, 'PROJECT_MANAGED_PRIVATE', now),
  ]);
  const rooms = await getRoomLabels([
    ...new Set([...privateScope.roomIds, ...managedScope.roomIds]),
  ]);
  const toOptions = (roomIds: string[]) => {
    const ids = new Set(roomIds);
    return rooms
      .filter((room) => ids.has(room.id))
      .map(({ id, label }) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  };
  const privateRooms = toOptions(privateScope.roomIds);
  const managedRooms = toOptions(managedScope.roomIds);
  return (
    <main
      data-testid="maintenance-new-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="New request"
        description="Describe the problem and where it is, attach up to 5 photos. Common-area reports skip the room picker."
        backHref="/maintenance"
        backLabel="Back to Maintenance"
        backTestId="maintenance-new-back"
      />
      <SectionCard title="Request details" className="max-w-3xl">
        <TicketCreateForm privateRooms={privateRooms} managedRooms={managedRooms} />
      </SectionCard>
    </main>
  );
}
