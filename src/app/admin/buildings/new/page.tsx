import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { PageHeader, SectionCard } from '@/shared/ui';
import { listAllBuildings } from '@/modules/property-membership/application/index';
import { BuildingCreateForm } from '@/modules/property-membership/ui/BuildingCreateForm';

export default async function AdminBuildingNewPage() {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/buildings/new');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const buildings = await listAllBuildings(actor);
  const projectId = buildings[0]?.projectId ?? '00000000-0000-4000-8000-000000000000';
  return (
    <main
      data-testid="admin-building-new-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="New building"
        description="Give the building a name and choose its initial status."
        backHref="/admin/buildings"
        backLabel="Back to buildings"
        backTestId="admin-building-new-back"
      />
      <SectionCard title="Building details" className="max-w-2xl">
        <BuildingCreateForm projectId={projectId} />
      </SectionCard>
    </main>
  );
}
