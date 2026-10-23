import 'server-only';
import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
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
import { listFacilityPage } from '@/modules/facility-booking/application/index';
import { FacilityCreateForm } from '@/modules/facility-booking/ui/FacilityCreateForm';
import { listAllBuildings } from '@/modules/property-membership/application/index';

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; query?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login');
  if (actor.mustChangePassword) redirect('/change-password');
  if (!actor.isSystemAdmin) redirect('/');
  const params = await searchParams;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const query = (params.query ?? '').slice(0, 255);
  const feed = await listFacilityPage(actor, { page, pageSize: 12, query });
  const buildings = await listAllBuildings(actor);
  const projectId = buildings[0]?.projectId ?? '00000000-0000-4000-8000-000000000000';
  return (
    <main
      data-testid="admin-facilities-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Facilities"
        description="Manage the spaces that bring your community together."
        actions={
          <FormDialog
            triggerLabel="New facility"
            title="New facility"
            description="Set up a shared space and its booking rules."
            triggerTestId="admin-facilities-create"
            testId="facility-create-dialog"
            size="lg"
          >
            <FacilityCreateForm projectId={projectId} />
          </FormDialog>
        }
      />
      <SearchField query={query} label="Search facilities" total={feed.total} />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="admin-facilities-empty"
          icon={CalendarDays}
          title={query ? 'No matching facilities' : 'No facilities yet'}
          description={
            query
              ? 'Try a different facility name.'
              : 'Shared spaces will appear here when they are available.'
          }
        />
      ) : (
        <ul
          data-testid="admin-facilities-list"
          className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3"
        >
          {feed.rows.map((row) => (
            <li key={row.id}>
              <ResourceCard
                href={`/admin/facilities/${row.id}`}
                title={row.name}
                description={row.description}
                icon={CalendarDays}
                testId={`admin-facilities-row-${row.id}`}
                status={
                  <Badge variant={row.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {row.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                }
                metadata={
                  <>
                    <span>
                      {row.capacity} {row.capacity === 1 ? 'space' : 'spaces'} per slot
                    </span>
                    <span className="ml-auto font-medium text-link">Manage facility</span>
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
        pagePath="/admin/facilities"
        querySuffix={query ? `&query=${encodeURIComponent(query)}` : ''}
        testId="admin-facilities-pages"
        nextTestId="admin-facilities-next"
        prevTestId="admin-facilities-prev"
        hideDisabledEnds
      />
    </main>
  );
}
