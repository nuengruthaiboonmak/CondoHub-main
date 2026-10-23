import 'server-only';
import { redirect } from 'next/navigation';
import { Building2, Layers3 } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import {
  Badge,
  EmptyState,
  FormDialog,
  PageHeader,
  Pagination,
  ResourceCard,
  SearchField,
} from '@/shared/ui';
import { listBuildingPage } from '@/modules/property-membership/application/index';
import { BuildingCreateForm } from '@/modules/property-membership/ui/BuildingCreateForm';

export default async function AdminBuildingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; query?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/buildings');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const query = (params.query ?? '').slice(0, 255);
  const feed = await listBuildingPage(actor, { page, pageSize: 12, query });
  const projectId = feed.rows[0]?.projectId ?? '00000000-0000-4000-8000-000000000000';
  return (
    <main
      data-testid="admin-buildings-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Buildings"
        description="An overview of your property, from each building to every room."
        actions={
          <FormDialog
            triggerLabel="New building"
            title="New building"
            size="sm"
            description="Add a building to organize its floors and rooms."
            triggerTestId="admin-buildings-create"
            testId="building-create-dialog"
          >
            <BuildingCreateForm projectId={projectId} />
          </FormDialog>
        }
      />
      <SearchField query={query} label="Search buildings" total={feed.total} />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="admin-buildings-empty"
          icon={Building2}
          title={query ? 'No matching buildings' : 'No buildings yet'}
          description={
            query
              ? 'Try a different building name.'
              : 'Create a building, then add its floors and rooms.'
          }
        />
      ) : (
        <ul
          data-testid="admin-buildings-list"
          aria-label="Buildings"
          className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3"
        >
          {feed.rows.map((building) => (
            <li key={building.id}>
              <ResourceCard
                href={`/admin/buildings/${building.id}`}
                title={building.name}
                icon={Building2}
                testId={`admin-buildings-row-${building.id}`}
                status={
                  <Badge variant={building.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {building.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                }
                metadata={
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <Layers3 aria-hidden="true" className="size-4" />
                      {building.floorCount} {building.floorCount === 1 ? 'floor' : 'floors'}
                    </span>
                    <span>
                      {building.roomCount} {building.roomCount === 1 ? 'room' : 'rooms'}
                    </span>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={page}
        totalPages={Math.ceil(feed.total / 12)}
        totalItems={feed.total}
        pagePath="/admin/buildings"
        querySuffix={query ? `&query=${encodeURIComponent(query)}` : ''}
        testId="admin-buildings-pages"
      />
    </main>
  );
}
