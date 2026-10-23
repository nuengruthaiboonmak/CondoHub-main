import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { PageHeader, SectionCard } from '@/shared/ui';
import { listAllBuildings } from '@/modules/property-membership/application/index';
import { FacilityCreateForm } from '@/modules/facility-booking/ui/FacilityCreateForm';

export default async function AdminFacilityNewPage() {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/facilities/new');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const buildings = await listAllBuildings(actor);
  const projectId = buildings[0]?.projectId ?? '00000000-0000-4000-8000-000000000000';
  return (
    <main
      data-testid="admin-facility-new-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="New facility"
        description="Set the name, opening hours, capacity, and booking rules."
        backHref="/admin/facilities"
        backLabel="Back to facilities"
        backTestId="admin-facility-new-back"
      />
      <SectionCard title="Facility details" className="max-w-3xl">
        <FacilityCreateForm projectId={projectId} />
      </SectionCard>
    </main>
  );
}
