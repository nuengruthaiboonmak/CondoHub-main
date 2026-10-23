import 'server-only';
import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { Badge, EmptyState, PageHeader, Pagination, ResourceCard, SearchField } from '@/shared/ui';
import { listFacilityPage } from '@/modules/facility-booking/application/index';

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; query?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const query = (params.query ?? '').slice(0, 255);
  const feed = await listFacilityPage(actor, { page, pageSize: 12, query, status: 'ACTIVE' });
  return (
    <main
      data-testid="facilities-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader title="Facilities" description="Make time for your favourite shared spaces." />
      <SearchField query={query} label="Search facilities" total={feed.total} />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="facilities-empty"
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
          data-testid="facilities-list"
          className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3"
        >
          {feed.rows.map((row) => (
            <li key={row.id}>
              <ResourceCard
                href={`/facilities/${row.id}`}
                title={row.name}
                description={row.description}
                icon={CalendarDays}
                testId={`facilities-row-${row.id}`}
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
                    <span className="ml-auto font-medium text-link">View availability</span>
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
        pagePath="/facilities"
        querySuffix={query ? `&query=${encodeURIComponent(query)}` : ''}
        testId="facilities-pages"
        nextTestId="facilities-next"
        prevTestId="facilities-prev"
        hideDisabledEnds
      />
    </main>
  );
}
