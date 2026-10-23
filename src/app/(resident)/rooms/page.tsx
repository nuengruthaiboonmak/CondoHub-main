import 'server-only';
import { redirect } from 'next/navigation';
import { DoorOpen } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { Badge, EmptyState, PageHeader, Pagination, ResourceCard, SearchField } from '@/shared/ui';
import { listActorRoomPage } from '@/modules/property-membership/application/index';

export default async function MyRoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; query?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/rooms');
  if (actor.mustChangePassword) redirect('/change-password');
  const params = await searchParams;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const query = (params.query ?? '').slice(0, 255);
  const feed = await listActorRoomPage(actor, { page, pageSize: 12, query }, systemClock.now());
  return (
    <main
      data-testid="my-rooms-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Rooms"
        description={
          actor.isSystemAdmin
            ? 'Find a room, manage its people, and review its details.'
            : 'Your rooms, their people, and everything connected to them.'
        }
      />
      <SearchField query={query} label="Search rooms or buildings" total={feed.total} />
      {feed.rows.length === 0 ? (
        <EmptyState
          data-testid="my-rooms-empty"
          icon={DoorOpen}
          title={query ? 'No matching rooms' : 'No rooms yet'}
          description={
            query
              ? 'Try a different room or building name.'
              : 'When you join or own a room, it will appear here.'
          }
        />
      ) : (
        <ul
          data-testid="my-rooms-list"
          className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3"
        >
          {feed.rows.map((room) => (
            <li key={room.id}>
              <ResourceCard
                href={`/rooms/${room.id}`}
                title={room.name}
                eyebrow={room.buildingName}
                icon={DoorOpen}
                testId={`my-rooms-row-${room.id}`}
                status={
                  <Badge variant={room.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {room.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                }
                metadata={
                  <>
                    <span>{room.floorLabel}</span>
                    <span className="ml-auto">{room.areaSqm} sqm</span>
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
        pagePath="/rooms"
        querySuffix={query ? `&query=${encodeURIComponent(query)}` : ''}
        testId="my-rooms-pages"
      />
    </main>
  );
}
