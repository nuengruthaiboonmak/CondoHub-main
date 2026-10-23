import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { systemClock } from '@/shared/utils/clock';
import { canViewRoom } from '../domain/roomVisibility';
import { formatTenancyPeriod } from '../domain/tenancyLabel';
import { covers } from '../domain/intervals';
import { isOwnerAt as isOwnerAtInterval, type OwnershipInterval } from '../domain/ownershipPolicy';
import { activeTenancyAt, type TenancyInterval } from '../domain/tenancyPolicy';
import {
  isActiveResident,
  residentIntervalsFor,
  activeResidentRooms,
  type MembershipWindow,
  type ResidentInterval,
  type TenancyWindow,
} from '../domain/residentEligibility';
import { canManageTenancy } from '../domain/managementModeGuards';
import {
  type MaintenanceRoutingKind,
  type RoomManagementMode as GuardManagementMode,
} from '../domain/managementModeGuards';
import { type PmAction, type RoomActVerdict } from '../domain/pmActions';
import { findUserById } from '@/modules/identity-access/infrastructure/userRepository';
import {
  queryRoomPage,
  listRoomLabels,
  findRoomById,
  isRoomOperational,
  listAllRooms,
  listRoomsByIds,
  type RoomRow,
} from '../infrastructure/structureRepository';
import {
  listOwnershipIntervalsByUser,
  listOwnershipsByRoom,
  type OwnershipRow,
} from '../infrastructure/ownershipRepository';
import {
  findTenancyById,
  listTenanciesByRoom,
  listTenancyLabels,
  type TenancyRow,
} from '../infrastructure/tenancyRepository';
import {
  listMembershipsByRoom,
  listMembershipsByTenancy,
  listMembershipsByUser,
  type MembershipRow,
} from '../infrastructure/membershipRepository';
import {
  membershipOverlapsServiceWindow,
  roomResidencyScope,
  tenantOverlapScope,
} from '../infrastructure/membershipScope';

export type { PmAction, RoomActVerdict, ResidentInterval };
export type { MaintenanceRoutingKind };

export interface OwnerRef {
  userId: string;
  ownershipId: string;
  startAt: Date;
  grantedBy: string | null;
}

export interface RentalPeriodDto {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  state: 'ACTIVE' | 'ENDED' | 'CANCELLED';
  managementMode: 'PROJECT_MANAGED' | 'PRIVATE_OWNER_MANAGED';
}

export interface MembershipInterval {
  start: Date;
  end: Date | null;
  memberRole: 'MAIN' | 'SUB';
}

export interface RoomDetail {
  id: string;
  floorId: string;
  buildingId: string;
  roomCode: string;
  name: string;
  areaSqm: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export type MaintenanceRouting = MaintenanceRoutingKind;

function toOwnershipIntervals(rows: OwnershipRow[]): OwnershipInterval[] {
  return rows.map((row) => ({
    roomId: row.roomId,
    userId: row.userId,
    start: row.startAt,
    end: row.endAt,
  }));
}

function toMembershipWindows(rows: MembershipRow[], tenancies: TenancyRow[]): MembershipWindow[] {
  const cancelled = new Set(
    tenancies.filter((row) => row.state === 'CANCELLED').map((row) => row.id),
  );
  return rows
    .filter((row) => row.tenancyId === null || !cancelled.has(row.tenancyId))
    .map((row) => ({
      roomId: row.roomId,
      userId: row.userId,
      start: row.startAt,
      end: row.endAt,
    }));
}

function toTenancyWindows(rows: TenancyRow[]): TenancyWindow[] {
  return rows
    .filter((row) => row.state !== 'CANCELLED')
    .map((row) => ({ roomId: row.roomId, start: row.startsAt, end: row.endsAt }));
}

function toTenancyIntervals(rows: TenancyRow[]): TenancyInterval[] {
  return rows.map((row) => ({
    roomId: row.roomId,
    state: row.state,
    start: row.startsAt,
    end: row.endsAt,
  }));
}

function toOwnerRefs(rows: OwnershipRow[], at: Date): OwnerRef[] {
  return rows
    .filter((row) => covers({ start: row.startAt, end: row.endAt }, at))
    .map((row) => ({
      userId: row.userId,
      ownershipId: row.id,
      startAt: row.startAt,
      grantedBy: row.grantedBy,
    }));
}

async function requireKnownActor(actorId: string, conn: Db = db): Promise<void> {
  const found = await findUserById(conn, actorId);
  if (found === null) throw new AppError('AUTH_REQUIRED');
}

async function requireKnownRoom(roomId: string, conn: Db = db): Promise<RoomRow> {
  const found = await findRoomById(conn, roomId, true);
  if (found === null) throw new AppError('RESOURCE_NOT_FOUND');
  return found;
}

export async function canActInRoom(
  actorId: string,
  roomId: string,
  action: PmAction,
  at: Date,
): Promise<RoomActVerdict> {
  await requireKnownActor(actorId);
  const room = await findRoomById(db, roomId);
  if (!room) throw new AppError('RESOURCE_NOT_FOUND');
  if (
    ['BOOK_FACILITY', 'SEND_CHAT', 'SUBMIT_MAINTENANCE', 'GRANT_CO_OWNER'].includes(action) &&
    !(await isRoomOperational(db, roomId))
  ) {
    return { allowed: false, reason: 'NO_CURRENT_ACCESS' };
  }
  const [ownerships, memberships, tenancies] = await Promise.all([
    listOwnershipsByRoom(db, roomId),
    listMembershipsByRoom(db, roomId),
    listTenanciesByRoom(db, roomId),
  ]);
  const ownershipIntervals = toOwnershipIntervals(ownerships);
  const membershipWindows = toMembershipWindows(memberships, tenancies);
  const tenancyWindows = toTenancyWindows(tenancies);
  const tenancyIntervals = toTenancyIntervals(tenancies);
  const ownerNow = isOwnerAtInterval(ownershipIntervals, roomId, actorId, at);
  const residentNow = isActiveResident(
    membershipWindows,
    ownershipIntervals,
    tenancyWindows,
    roomId,
    actorId,
    at,
  );
  switch (action) {
    case 'BOOK_FACILITY':
    case 'VIEW_CHAT':
    case 'SEND_CHAT':
    case 'SUBMIT_MAINTENANCE':
      return residentNow ? { allowed: true } : { allowed: false, reason: 'NO_CURRENT_ACCESS' };
    case 'VIEW_ROOM':
      return canViewRoom(residentNow, ownerNow)
        ? { allowed: true }
        : { allowed: false, reason: 'NO_CURRENT_ACCESS' };
    case 'PAY_INVOICE':
    case 'VIEW_FINANCE':
      return residentNow || ownerNow
        ? { allowed: true }
        : { allowed: false, reason: 'NO_CURRENT_ACCESS' };
    case 'MANAGE_MEMBERS': {
      const activeRow = tenancies.find(
        (row) => row.state === 'ACTIVE' && covers({ start: row.startsAt, end: row.endsAt }, at),
      );
      if (ownerNow && activeRow?.managementMode !== 'PROJECT_MANAGED') {
        return { allowed: true };
      }
      const mainNow = memberships.some(
        (membership) =>
          membership.userId === actorId &&
          membership.memberRole === 'MAIN' &&
          (membership.tenancyId === null ||
            tenancies.some(
              (row) => row.id === membership.tenancyId && row.state !== 'CANCELLED',
            )) &&
          covers({ start: membership.startAt, end: membership.endAt }, at),
      );
      return mainNow ? { allowed: true } : { allowed: false, reason: 'NO_CURRENT_ACCESS' };
    }
    case 'GRANT_CO_OWNER':
      return ownerNow ? { allowed: true } : { allowed: false, reason: 'NOT_ROOM_OWNER' };
    case 'TRANSFER_OWNERSHIP':
    case 'ADMINISTER_ROOM':
      return { allowed: false, reason: 'ADMIN_ONLY' };
    case 'MANAGE_TENANCY': {
      const activeTenancy = activeTenancyAt(tenancyIntervals, roomId, at);
      if (activeTenancy === null) return { allowed: false, reason: 'NO_CURRENT_ACCESS' };
      const activeRow = tenancies.find(
        (row) => row.state === 'ACTIVE' && covers({ start: row.startsAt, end: row.endsAt }, at),
      );
      if (activeRow === undefined) return { allowed: false, reason: 'NO_CURRENT_ACCESS' };
      const allowed = canManageTenancy(activeRow.managementMode, {
        actorIsSystemAdmin: false,
        actorIsActiveOwner: ownerNow,
      });
      return allowed ? { allowed: true } : { allowed: false, reason: 'MANAGER_REQUIRED' };
    }
  }
}

export async function getResidentIntervals(
  userId: string,
  roomId: string,
): Promise<ResidentInterval[]> {
  await requireKnownActor(userId);
  await requireKnownRoom(roomId);
  const [memberships, ownerships, tenancies] = await Promise.all([
    listMembershipsByRoom(db, roomId),
    listOwnershipsByRoom(db, roomId),
    listTenanciesByRoom(db, roomId),
  ]);
  return residentIntervalsFor(
    toMembershipWindows(memberships, tenancies),
    toOwnershipIntervals(ownerships),
    toTenancyWindows(tenancies),
    roomId,
    userId,
  );
}

export async function getRentalPeriods(
  roomId: string,
  month: string,
  options?: { includeCancelled?: boolean },
): Promise<RentalPeriodDto[]> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new AppError('VALIDATION_ERROR', 'The month must use YYYY-MM format.');
  }
  await requireKnownRoom(roomId);
  const tenancies = await listTenanciesByRoom(db, roomId);
  const [yearText, monthText] = month.split('-') as [string, string];
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  const monthStart = Date.UTC(year, monthIndex - 1, 1);
  const monthEnd = Date.UTC(year, monthIndex, 1);
  return tenancies
    .filter((tenancy) => {
      if (tenancy.state === 'CANCELLED' && !options?.includeCancelled) return false;
      const start = tenancy.startsAt.getTime();
      const end = tenancy.endsAt === null ? Number.POSITIVE_INFINITY : tenancy.endsAt.getTime();
      return start < monthEnd && monthStart < end;
    })
    .map((tenancy) => ({
      id: tenancy.id,
      startsAt: tenancy.startsAt,
      endsAt: tenancy.endsAt,
      state: tenancy.state,
      managementMode: tenancy.managementMode,
    }));
}

export async function getCurrentOwners(roomId: string, at?: Date): Promise<OwnerRef[]> {
  await requireKnownRoom(roomId);
  const ownerships = await listOwnershipsByRoom(db, roomId);
  return toOwnerRefs(ownerships, at ?? systemClock.now());
}

export async function getOwnersAt(roomId: string, at: Date): Promise<OwnerRef[]> {
  await requireKnownRoom(roomId);
  const ownerships = await listOwnershipsByRoom(db, roomId);
  return toOwnerRefs(ownerships, at);
}

export async function getMembershipIntervals(
  userId: string,
  tenancyId: string,
): Promise<MembershipInterval[]> {
  await requireKnownActor(userId);
  const tenancy = await findTenancyById(db, tenancyId);
  if (tenancy === null) throw new AppError('RESOURCE_NOT_FOUND');
  const memberships = await listMembershipsByTenancy(db, tenancyId);
  return memberships
    .filter((membership) => membership.userId === userId)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((membership) => ({
      start: membership.startAt,
      end: membership.endAt,
      memberRole: membership.memberRole,
    }));
}

export async function getActiveResidentRooms(userId: string, at: Date): Promise<string[]> {
  await requireKnownActor(userId);
  const [memberships, ownerships] = await Promise.all([
    listMembershipsByUser(db, userId),
    listOwnershipIntervalsByUser(db, userId),
  ]);
  const roomIds = new Set<string>();
  for (const membership of memberships) roomIds.add(membership.roomId);
  for (const ownership of ownerships) roomIds.add(ownership.roomId);
  const tenancies: TenancyRow[] = [];
  for (const roomId of roomIds) {
    const rows = await listTenanciesByRoom(db, roomId);
    tenancies.push(...rows);
  }
  const residentIds = activeResidentRooms(
    toMembershipWindows(memberships, tenancies),
    toOwnershipIntervals(ownerships),
    toTenancyWindows(tenancies),
    userId,
    at,
  );
  return (await listRoomsByIds(db, residentIds)).map((entry) => entry.id);
}

export async function getEligibleMaintenanceRooms(
  userId: string,
  routingKind: MaintenanceRouting,
  at: Date,
): Promise<string[]> {
  await requireKnownActor(userId);
  if (routingKind === 'COMMON_AREA') return [];
  const [memberships, ownerships] = await Promise.all([
    listMembershipsByUser(db, userId),
    listOwnershipIntervalsByUser(db, userId),
  ]);
  const roomIds = new Set<string>();
  for (const membership of memberships) roomIds.add(membership.roomId);
  for (const ownership of ownerships) roomIds.add(ownership.roomId);
  const tenancies: TenancyRow[] = [];
  const modes = new Map<string, GuardManagementMode | null>();
  for (const roomId of roomIds) {
    const rows = await listTenanciesByRoom(db, roomId);
    tenancies.push(...rows);
    const active = rows.find(
      (row) => row.state === 'ACTIVE' && covers({ start: row.startsAt, end: row.endsAt }, at),
    );
    modes.set(roomId, active === undefined ? null : active.managementMode);
  }
  const membershipWindows = toMembershipWindows(memberships, tenancies);
  const ownershipIntervals = toOwnershipIntervals(ownerships);
  const tenancyWindows = toTenancyWindows(tenancies);
  const eligible: string[] = [];
  for (const roomId of roomIds) {
    if (!(await isRoomOperational(db, roomId))) continue;
    const resident = isActiveResident(
      membershipWindows,
      ownershipIntervals,
      tenancyWindows,
      roomId,
      userId,
      at,
    );
    if (!resident) continue;
    const mode = modes.get(roomId) ?? null;
    if (routingKind === 'PRIVATE_OWNER' && mode === 'PROJECT_MANAGED') continue;
    if (routingKind === 'PROJECT_MANAGED_PRIVATE' && mode !== 'PROJECT_MANAGED') continue;
    eligible.push(roomId);
  }
  return eligible.sort();
}

export async function isOwnerAt(roomId: string, userId: string, at: Date): Promise<boolean> {
  await requireKnownActor(userId);
  await requireKnownRoom(roomId);
  const ownerships = await listOwnershipsByRoom(db, roomId);
  return isOwnerAtInterval(toOwnershipIntervals(ownerships), roomId, userId, at);
}

export async function resolveActorRooms(actor: Actor, at: Date): Promise<RoomRow[]> {
  if (actor.isSystemAdmin) return listAllRooms(db);
  const roomIds = await visibleRoomIds(actor.userId, at);
  return listRoomsByIds(db, roomIds);
}

export async function getRoomDetail(roomId: string): Promise<RoomDetail> {
  const room = await findRoomById(db, roomId);
  if (!room) throw new AppError('RESOURCE_NOT_FOUND');
  return {
    id: room.id,
    floorId: room.floorId,
    buildingId: room.buildingId,
    roomCode: room.roomCode,
    name: room.name,
    areaSqm: room.areaSqm,
    status: room.status,
  };
}

export interface MembershipWindowRef {
  roomId: string;
  tenancyId: string | null;
  start: Date;
  end: Date | null;
}

export async function listMembershipWindowsByUser(userId: string): Promise<MembershipWindowRef[]> {
  await requireKnownActor(userId);
  const memberships = await listMembershipsByUser(db, userId);
  return memberships.map((membership) => ({
    roomId: membership.roomId,
    tenancyId: membership.tenancyId,
    start: membership.startAt,
    end: membership.endAt,
  }));
}

export { membershipOverlapsServiceWindow, roomResidencyScope, tenantOverlapScope };

export async function listActorRoomPage(
  actor: Actor,
  input: { query?: string | undefined; page: number; pageSize: number },
  at: Date,
) {
  if (actor.accountStatus !== 'ACTIVE' || actor.mustChangePassword)
    throw new AppError('ACCESS_DENIED');
  const roomIds = actor.isSystemAdmin ? null : await visibleRoomIds(actor.userId, at);
  return queryRoomPage(db, {
    ...input,
    roomIds,
    page: Math.max(1, input.page),
    pageSize: Math.min(100, Math.max(1, input.pageSize)),
  });
}

export async function getRoomLabels(roomIds: string[]) {
  return listRoomLabels(db, roomIds);
}

export async function getTenancyLabels(tenancyIds: string[]) {
  return Object.fromEntries(
    (await listTenancyLabels(db, [...new Set(tenancyIds)])).map((row) => [
      row.id,
      formatTenancyPeriod(row),
    ]),
  );
}

async function visibleRoomIds(userId: string, at: Date): Promise<string[]> {
  const [residentRooms, ownerships] = await Promise.all([
    getActiveResidentRooms(userId, at),
    listOwnershipIntervalsByUser(db, userId),
  ]);
  return [
    ...new Set([
      ...residentRooms,
      ...ownerships
        .filter((row) => covers({ start: row.startAt, end: row.endAt }, at))
        .map((row) => row.roomId),
    ]),
  ].sort();
}
