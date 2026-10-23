import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';

export interface FacilitySummary {
  id: string;
  code: string;
  name: string;
  capacity: number;
  status: string;
}

export interface FacilityListEnvelope {
  data: FacilitySummary[];
  meta: { page: number; pageSize: number; total: number };
}

export interface RoomSummary {
  id: string;
  roomCode: string;
}

export interface RoomListEnvelope {
  data: RoomSummary[];
}

export interface SlotRow {
  startsAt: string;
  endsAt: string;
  remaining: number;
  available: boolean;
}

export interface SlotsEnvelope {
  data: {
    date: string;
    roomId: string;
    quotaKind: string;
    quotaLimit: number;
    quotaUsed: number;
    periodKey: string;
    slots: SlotRow[];
  };
}

export interface BookingEnvelope {
  data: {
    id: string;
    roomId: string;
    facilityId: string;
    slots: Array<{ id: string; startsAt: string; state: string; refundQuota: boolean }>;
  };
}

export interface QuotaEnvelope {
  data: { quotaKind: string; quotaLimit: number; quotaUsed: number; periodKey: string };
}

function openDays(
  open: string,
  close: string,
): Record<string, { open: Array<{ start: string; end: string }>; breaks: never[] }> {
  const days: Record<string, { open: Array<{ start: string; end: string }>; breaks: never[] }> = {};
  for (const day of ['0', '1', '2', '3', '4', '5', '6']) {
    days[day] = { open: [{ start: open, end: close }], breaks: [] };
  }
  return days;
}

export function wideOpenSchedule(): Record<
  string,
  { open: Array<{ start: string; end: string }>; breaks: never[] }
> {
  return openDays('00:00', '24:00');
}

export function daytimeSchedule(): Record<
  string,
  { open: Array<{ start: string; end: string }>; breaks: never[] }
> {
  return openDays('08:00', '20:00');
}

export async function createFacility(
  page: Page,
  input: {
    code: string;
    name: string;
    capacity?: number;
    quotaLimit?: number;
    schedule?: Record<string, { open: Array<{ start: string; end: string }>; breaks: never[] }>;
    projectId?: string;
  },
): Promise<{ id: string }> {
  const created = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/facilities',
    body: {
      projectId: input.projectId ?? randomUUID(),
      code: input.code,
      name: input.name,
      description: `E2E booking fixture ${input.code}.`,
      status: 'ACTIVE',
      capacity: input.capacity ?? 1,
      schedule: { days: input.schedule ?? wideOpenSchedule(), holidays: [] },
      slotMinutes: 60,
      quotaKind: 'DAILY',
      quotaLimit: input.quotaLimit ?? 10,
      advanceDays: 30,
    },
  });
  expect(created.status).toBe(200);
  return { id: created.json.data.id };
}

export async function findRoom(page: Page, roomCode: string): Promise<string> {
  const listed = await apiJson<RoomListEnvelope>(page.request, {
    method: 'GET',
    path: `/api/rooms?pageSize=100&query=${encodeURIComponent(roomCode)}`,
  });
  expect(listed.status).toBe(200);
  const room = listed.json.data.find((candidate) => candidate.roomCode === roomCode);
  expect(room).toBeDefined();
  return room?.id ?? '';
}

export async function slotsFor(
  page: Page,
  facilityId: string,
  date: string,
  roomId: string,
): Promise<SlotsEnvelope['data']> {
  const slots = await apiJson<SlotsEnvelope>(page.request, {
    method: 'GET',
    path: `/api/facilities/${facilityId}/slots?date=${date}&roomId=${roomId}`,
  });
  expect(slots.status).toBe(200);
  return slots.json.data;
}

export async function bookSlots(
  page: Page,
  facilityId: string,
  input: { roomId: string; startsAt: string[] },
): Promise<BookingEnvelope['data']> {
  const booked = await apiJson<BookingEnvelope>(page.request, {
    method: 'POST',
    path: `/api/facilities/${facilityId}/bookings`,
    body: { roomId: input.roomId, startsAt: input.startsAt },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(booked.status).toBe(200);
  return booked.json.data;
}

export async function quotaFor(
  page: Page,
  facilityId: string,
  roomId: string,
  date?: string,
): Promise<QuotaEnvelope['data']> {
  const quota = await apiJson<QuotaEnvelope>(page.request, {
    method: 'GET',
    path: `/api/facilities/${facilityId}/quota?roomId=${roomId}${date === undefined ? '' : `&date=${date}`}`,
  });
  expect(quota.status).toBe(200);
  return quota.json.data;
}

export function idempotencyKey(): string {
  return randomUUID();
}
