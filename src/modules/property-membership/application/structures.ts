import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import {
  queryBuildingPage,
  findBuildingById,
  findFloorById,
  findRoomById,
  insertBuilding,
  insertFloor,
  insertRoom,
  listBuildings,
  listFloorsByBuilding,
  listRoomsByBuilding,
  updateBuildingStatus,
  updateBuildingDetails as updateBuildingDetailsRow,
  updateFloor as updateFloorRow,
  updateRoom,
  lockBuildingForUpdate,
  lockFloorForUpdate,
  type BuildingRow,
  type FloorRow,
  type RoomRow,
} from '../infrastructure/structureRepository';
import {
  listActiveMembershipsByRoom,
  listMembershipsByRoom,
} from '../infrastructure/membershipRepository';
import {
  listActiveTenanciesByRoom,
  listTenanciesByRoom,
} from '../infrastructure/tenancyRepository';
import { listOwnershipsByRoom } from '../infrastructure/ownershipRepository';
import type { PropertyCtx } from './ctx';
import { deletePropertyResource } from './resourceLifecycle';

function requireAdmin(actor: Actor): void {
  if (!actor.isSystemAdmin || actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

export interface RoomImpactPreview {
  activeTenancies: number;
  activeMemberships: number;
  ownershipIntervals: number;
  tenancyIntervals: number;
  membershipIntervals: number;
}

export async function createBuilding(
  actor: Actor,
  input: {
    projectId: string;
    code?: string | undefined;
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
  },
  ctx: PropertyCtx,
): Promise<BuildingRow> {
  requireAdmin(actor);
  try {
    return await db.transaction(async (tx) => {
      const created = await insertBuilding(tx, {
        ...input,
        code: input.code ?? `bld_${crypto.randomUUID()}`,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'building.created',
        resourceType: 'building',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { code: created.code, name: created.name, status: created.status },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { building_project_code_uq: 'VALIDATION_ERROR' },
    });
  }
}

export async function createFloor(
  actor: Actor,
  input: { buildingId: string; code?: string | undefined; label: string },
  ctx: PropertyCtx,
): Promise<FloorRow> {
  requireAdmin(actor);
  const building = await findBuildingById(db, input.buildingId);
  if (building === null) throw new AppError('RESOURCE_NOT_FOUND');
  try {
    return await db.transaction(async (tx) => {
      if (!(await lockBuildingForUpdate(tx, input.buildingId)))
        throw new AppError('RESOURCE_NOT_FOUND');
      const created = await insertFloor(tx, {
        ...input,
        code: input.code ?? `flr_${crypto.randomUUID()}`,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'floor.created',
        resourceType: 'floor',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { buildingId: created.buildingId, code: created.code },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { floor_building_code_uq: 'VALIDATION_ERROR' },
    });
  }
}

export async function createRoom(
  actor: Actor,
  input: {
    floorId: string;
    buildingId: string;
    roomCode?: string | undefined;
    name?: string | undefined;
    areaSqm: string;
    status: 'ACTIVE' | 'INACTIVE';
  },
  ctx: PropertyCtx,
): Promise<RoomRow> {
  requireAdmin(actor);
  const floor = await findFloorById(db, input.floorId);
  if (floor === null || floor.buildingId !== input.buildingId) {
    throw new AppError('VALIDATION_ERROR', 'The floor does not belong to the building.');
  }
  try {
    return await db.transaction(async (tx) => {
      if (!(await lockFloorForUpdate(tx, input.floorId))) throw new AppError('RESOURCE_NOT_FOUND');
      const created = await insertRoom(tx, {
        ...input,
        roomCode: input.roomCode ?? `rom_${crypto.randomUUID()}`,
        name: input.name ?? input.roomCode ?? 'Room',
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'room.created',
        resourceType: 'room',
        resourceId: created.id,
        requestId: ctx.requestId,
        after: { roomCode: created.roomCode, areaSqm: created.areaSqm },
      });
      return created;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { room_building_code_uq: 'VALIDATION_ERROR' },
    });
  }
}

export async function previewRoomImpact(roomId: string): Promise<RoomImpactPreview> {
  const room = await findRoomById(db, roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const [activeTenancies, activeMemberships, ownerships, tenancies, memberships] =
    await Promise.all([
      listActiveTenanciesByRoom(db, roomId),
      listActiveMembershipsByRoom(db, roomId),
      listOwnershipsByRoom(db, roomId),
      listTenanciesByRoom(db, roomId),
      listMembershipsByRoom(db, roomId),
    ]);
  return {
    activeTenancies: activeTenancies.length,
    activeMemberships: activeMemberships.length,
    ownershipIntervals: ownerships.length,
    tenancyIntervals: tenancies.length,
    membershipIntervals: memberships.length,
  };
}

export async function disableRoom(
  actor: Actor,
  roomId: string,
  ctx: PropertyCtx,
): Promise<{ room: RoomRow; impact: RoomImpactPreview }> {
  requireAdmin(actor);
  const impact = await previewRoomImpact(roomId);
  const room = await findRoomById(db, roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  const updated = await db.transaction(async (tx) => {
    const next = await updateRoom(tx, roomId, { status: 'INACTIVE' });
    if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'room.disabled',
      resourceType: 'room',
      resourceId: roomId,
      requestId: ctx.requestId,
      before: { status: room.status },
      after: { status: 'INACTIVE', impact },
    });
    return next;
  });
  return { room: updated, impact };
}

export async function updateRoomDetails(
  actor: Actor,
  roomId: string,
  input: {
    name?: string | undefined;
    areaSqm?: string | undefined;
    status?: 'ACTIVE' | 'INACTIVE' | undefined;
  },
  ctx: PropertyCtx,
): Promise<RoomRow> {
  requireAdmin(actor);
  if (input.name === undefined && input.areaSqm === undefined && input.status === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Provide a name, area, or status to update.');
  }
  const room = await findRoomById(db, roomId);
  if (room === null) throw new AppError('RESOURCE_NOT_FOUND');
  try {
    return await db.transaction(async (tx) => {
      const next = await updateRoom(tx, roomId, input);
      if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'room.updated',
        resourceType: 'room',
        resourceId: roomId,
        requestId: ctx.requestId,
        before: { name: room.name, areaSqm: room.areaSqm, status: room.status },
        after: { name: next.name, areaSqm: next.areaSqm, status: next.status },
      });
      return next;
    });
  } catch (error) {
    throw mapPgError(error);
  }
}

export async function disableBuilding(
  actor: Actor,
  buildingId: string,
  ctx: PropertyCtx,
): Promise<BuildingRow> {
  requireAdmin(actor);
  const building = await findBuildingById(db, buildingId);
  if (building === null) throw new AppError('RESOURCE_NOT_FOUND');
  const updated = await db.transaction(async (tx) => {
    const next = await updateBuildingStatus(tx, buildingId, 'INACTIVE');
    if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'building.disabled',
      resourceType: 'building',
      resourceId: buildingId,
      requestId: ctx.requestId,
      before: { status: building.status },
      after: { status: 'INACTIVE' },
    });
    return next;
  });
  return updated;
}

export async function enableBuilding(
  actor: Actor,
  buildingId: string,
  ctx: PropertyCtx,
): Promise<BuildingRow> {
  requireAdmin(actor);
  const building = await findBuildingById(db, buildingId);
  if (building === null) throw new AppError('RESOURCE_NOT_FOUND');
  const updated = await db.transaction(async (tx) => {
    const next = await updateBuildingStatus(tx, buildingId, 'ACTIVE');
    if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'building.enabled',
      resourceType: 'building',
      resourceId: buildingId,
      requestId: ctx.requestId,
      before: { status: building.status },
      after: { status: 'ACTIVE' },
    });
    return next;
  });
  return updated;
}

export async function updateFloor(
  actor: Actor,
  input: {
    floorId: string;
    code?: string | undefined;
    label?: string | undefined;
    status?: 'ACTIVE' | 'INACTIVE' | undefined;
  },
  ctx: PropertyCtx,
): Promise<FloorRow> {
  requireAdmin(actor);
  if (input.code === undefined && input.label === undefined && input.status === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Provide a name or status to update.');
  }
  const floor = await findFloorById(db, input.floorId);
  if (floor === null) throw new AppError('RESOURCE_NOT_FOUND');
  try {
    return await db.transaction(async (tx) => {
      const next = await updateFloorRow(tx, input.floorId, {
        code: input.code,
        label: input.label,
        status: input.status,
      });
      if (next === null) throw new AppError('RESOURCE_NOT_FOUND');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'floor.updated',
        resourceType: 'floor',
        resourceId: input.floorId,
        requestId: ctx.requestId,
        before: { code: floor.code, label: floor.label, status: floor.status },
        after: { code: next.code, label: next.label, status: next.status },
      });
      return next;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: { floor_building_code_uq: 'VALIDATION_ERROR' },
    });
  }
}

export async function deleteFloor(
  actor: Actor,
  floorId: string,
  ctx: PropertyCtx,
): Promise<{ floor: FloorRow }> {
  requireAdmin(actor);
  const floor = await findFloorById(db, floorId);
  if (floor === null) throw new AppError('RESOURCE_NOT_FOUND');
  await deletePropertyResource(actor, 'floor', floorId, ctx);
  return { floor };
}

export async function listBuildingStructures(
  actor: Actor,
  buildingId: string,
): Promise<{ building: BuildingRow; floors: FloorRow[]; rooms: RoomRow[] }> {
  requireAdmin(actor);
  const building = await findBuildingById(db, buildingId);
  if (building === null) throw new AppError('RESOURCE_NOT_FOUND');
  const [floors, rooms] = await Promise.all([
    listFloorsByBuilding(db, buildingId),
    listRoomsByBuilding(db, buildingId),
  ]);
  return { building, floors, rooms };
}

export async function listAllBuildings(actor: Actor): Promise<BuildingRow[]> {
  requireAdmin(actor);
  return listBuildings(db);
}

export async function listBuildingPage(
  actor: Actor,
  input: { page: number; pageSize: number; query?: string | undefined },
) {
  requireAdmin(actor);
  return queryBuildingPage(db, {
    ...input,
    page: Math.max(1, input.page),
    pageSize: Math.min(100, Math.max(1, input.pageSize)),
  });
}

export async function updateBuildingDetails(
  actor: Actor,
  buildingId: string,
  input: { name?: string | undefined; status?: 'ACTIVE' | 'INACTIVE' | undefined },
  ctx: PropertyCtx,
) {
  requireAdmin(actor);
  const existing = await findBuildingById(db, buildingId);
  if (!existing) throw new AppError('RESOURCE_NOT_FOUND');
  if (input.name === undefined && input.status === undefined)
    throw new AppError('VALIDATION_ERROR');
  return db.transaction(async (tx) => {
    const updated = await updateBuildingDetailsRow(tx, buildingId, input);
    if (!updated) throw new AppError('RESOURCE_NOT_FOUND');
    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'building.updated',
      resourceType: 'building',
      resourceId: buildingId,
      requestId: ctx.requestId,
      before: { name: existing.name, status: existing.status },
      after: { name: updated.name, status: updated.status },
    });
    return updated;
  });
}
