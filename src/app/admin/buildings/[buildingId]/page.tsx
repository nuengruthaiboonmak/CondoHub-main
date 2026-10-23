import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, DoorOpen, Layers3, MessageCircle } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import {
  ActionMenu,
  Badge,
  EmptyState,
  FormDialog,
  PageHeader,
  Pagination,
  ResourceDeleteControl,
  cx,
} from '@/shared/ui';
import { listBuildingStructures } from '@/modules/property-membership/application/index';
import { FloorCreateForm } from '@/modules/property-membership/ui/FloorCreateForm';
import { RoomCreateForm } from '@/modules/property-membership/ui/RoomCreateForm';
import { BuildingEditForm } from '@/modules/property-membership/ui/BuildingEditForm';
import { BuildingStatusControl } from '@/modules/property-membership/ui/BuildingStatusControl';
import { FloorRowActions } from '@/modules/property-membership/ui/FloorRowActions';
import { RoomPeopleActions } from '@/modules/property-membership/ui/RoomPeopleActions';
import { RoomRowActions } from '@/modules/property-membership/ui/RoomRowActions';

export default async function AdminBuildingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ buildingId: string }>;
  searchParams: Promise<{ floorId?: string; page?: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/buildings');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const { buildingId } = await params;
  const structures = await listBuildingStructures(actor, buildingId).catch(() => null);
  if (structures === null) redirect('/admin/buildings');
  const query = await searchParams;
  const selectedFloor = structures.floors.find((floor) => floor.id === query.floorId);
  const floorNames = new Map(structures.floors.map((floor) => [floor.id, floor.label]));
  const roomCounts = new Map<string, number>();
  for (const room of structures.rooms)
    roomCounts.set(room.floorId, (roomCounts.get(room.floorId) ?? 0) + 1);
  const filteredRooms = structures.rooms.filter(
    (room) => !selectedFloor || room.floorId === selectedFloor.id,
  );
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filteredRooms.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(query.page) || 1)));
  const rooms = filteredRooms.slice((page - 1) * pageSize, page * pageSize);
  const path = `/admin/buildings/${buildingId}`;
  return (
    <main
      data-testid="admin-building-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-6 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title={structures.building.name}
        description={`${structures.floors.length} ${structures.floors.length === 1 ? 'floor' : 'floors'} · ${structures.rooms.length} ${structures.rooms.length === 1 ? 'room' : 'rooms'}`}
        backHref="/admin/buildings"
        backLabel="Back to buildings"
        actions={
          <>
            <Badge variant={structures.building.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {structures.building.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </Badge>
            <ActionMenu label="Building actions" testId="building-actions">
              <FormDialog
                icon="edit"
                triggerLabel="Edit building"
                title="Edit building"
                triggerTestId="building-edit-open"
                testId="building-edit-dialog"
                variant="ghost"
              >
                <BuildingEditForm buildingId={buildingId} name={structures.building.name} />
              </FormDialog>
              <BuildingStatusControl buildingId={buildingId} status={structures.building.status} />
              <ResourceDeleteControl
                resource="building"
                name={structures.building.name}
                endpoint={`/api/admin/buildings/${buildingId}`}
                testId="building-delete"
                redirectTo="/admin/buildings"
                description="This building, its floors and rooms will be removed from the directory. End active or scheduled rentals and memberships first. Bills and history stay recorded."
              />
            </ActionMenu>
          </>
        }
      />
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <section aria-label="Floors" className="min-w-0 rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-border p-4">
            <h2 className="text-heading font-semibold">Floors</h2>
            <FormDialog
              size="sm"
              triggerLabel="New floor"
              title="New floor"
              triggerTestId="floor-create-open"
              testId="floor-create-dialog"
              variant="secondary"
            >
              <FloorCreateForm buildingId={buildingId} />
            </FormDialog>
          </div>
          <nav aria-label="Building floors" className="p-2">
            <Link
              href={path}
              aria-current={!selectedFloor ? 'page' : undefined}
              className={cx(
                'mb-1 flex min-h-12 items-center gap-3 rounded-lg px-3 text-body font-medium',
                !selectedFloor
                  ? 'bg-nav-active text-nav-active-foreground'
                  : 'text-body-secondary hover:bg-ghost-hover',
              )}
            >
              <Layers3 aria-hidden="true" className="size-4" />
              <span className="flex-1">All rooms</span>
              <span className="text-small tabular-nums">{structures.rooms.length}</span>
            </Link>
            {structures.floors.length === 0 ? (
              <p
                data-testid="admin-floors-empty"
                className="px-3 py-5 text-small leading-relaxed text-muted-foreground"
              >
                Create a floor to start organizing rooms.
              </p>
            ) : (
              <ul data-testid="admin-floors-list" className="flex flex-col gap-1">
                {structures.floors.map((floor) => (
                  <li
                    key={floor.id}
                    data-testid={`admin-floor-${floor.id}`}
                    className={cx(
                      'flex min-w-0 items-center gap-1 rounded-lg p-1',
                      selectedFloor?.id === floor.id && 'bg-nav-active',
                    )}
                  >
                    <Link
                      href={`${path}?floorId=${floor.id}`}
                      aria-current={selectedFloor?.id === floor.id ? 'page' : undefined}
                      className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      <span title={floor.label} className="truncate text-body font-medium">
                        {floor.label}
                      </span>
                      {floor.status === 'INACTIVE' ? (
                        <span className="text-xs font-medium text-muted-foreground">Inactive</span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {roomCounts.get(floor.id) ?? 0}{' '}
                        {(roomCounts.get(floor.id) ?? 0) === 1 ? 'room' : 'rooms'}
                      </span>
                    </Link>
                    <ActionMenu
                      label={`Actions for ${floor.label}`}
                      testId={`floor-actions-${floor.id}`}
                      side="right"
                    >
                      <FloorRowActions
                        floorId={floor.id}
                        label={floor.label}
                        status={floor.status}
                      />
                    </ActionMenu>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </section>
        <section aria-label="Rooms" className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <h2 className="text-title font-semibold">{selectedFloor?.label ?? 'All rooms'}</h2>
              <p className="mt-1 text-small text-muted-foreground">
                {filteredRooms.length} {filteredRooms.length === 1 ? 'room' : 'rooms'} · Manage
                spaces, people, and access.
              </p>
            </div>
            <FormDialog
              triggerLabel="New room"
              disabled={structures.floors.length === 0}
              triggerTitle={
                structures.floors.length === 0 ? 'Create a floor before adding a room.' : 'New room'
              }
              title="New room"
              description="Choose a floor and give the room a name."
              triggerTestId="room-create-open"
              testId="room-create-dialog"
            >
              <RoomCreateForm
                buildingId={buildingId}
                floors={structures.floors.map((floor) => ({
                  id: floor.id,
                  code: floor.code,
                  label: floor.label,
                }))}
                defaultFloorId={selectedFloor?.id ?? ''}
              />
            </FormDialog>
          </div>
          {rooms.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface">
              <EmptyState
                data-testid="admin-rooms-empty"
                icon={DoorOpen}
                title="No rooms yet"
                description={
                  structures.floors.length
                    ? 'Add the first room using New room.'
                    : 'Create a floor, then add your first room.'
                }
              />
            </div>
          ) : (
            <ul
              data-testid="admin-rooms-list"
              className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2"
            >
              {rooms.map((room) => (
                <li
                  key={room.id}
                  data-row-key={room.id}
                  className="min-w-0 rounded-xl border border-border bg-surface p-5 transition-colors duration-150 hover:border-border-strong motion-reduce:transition-none"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-primary"
                    >
                      <DoorOpen className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/rooms/${room.id}`}
                        title={room.name}
                        className="block truncate rounded-lg text-heading font-semibold text-foreground hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        {room.name}
                      </Link>
                      <p className="mt-1 truncate text-small text-muted-foreground">
                        {floorNames.get(room.floorId)} · {room.areaSqm} sqm
                      </p>
                    </div>
                    <ActionMenu
                      label={`Actions for ${room.name}`}
                      testId={`room-actions-${room.id}`}
                    >
                      <RoomPeopleActions
                        roomId={room.id}
                        roomName={room.name}
                        showDetails={false}
                      />
                      <RoomRowActions
                        roomId={room.id}
                        areaSqm={room.areaSqm}
                        status={room.status}
                        name={room.name}
                      />
                    </ActionMenu>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <Badge variant={room.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {room.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </Badge>
                    <div className="flex items-center gap-3">
                      <Link
                        data-testid={`admin-rooms-chat-${room.id}`}
                        href={`/admin/rooms/${room.id}/chat`}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-small font-medium text-body-secondary hover:text-link"
                      >
                        <MessageCircle aria-hidden="true" className="size-4" />
                        Chat
                      </Link>
                      <Link
                        data-testid={`room-people-link-${room.id}`}
                        href={`/rooms/${room.id}`}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-small font-medium text-link"
                      >
                        Manage room
                        <ArrowUpRight aria-hidden="true" className="size-4" />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={filteredRooms.length}
              pagePath={path}
              querySuffix={selectedFloor ? `&floorId=${selectedFloor.id}` : ''}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
