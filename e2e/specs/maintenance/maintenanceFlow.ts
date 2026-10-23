import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiJson } from '../../helpers/api';

export type MaintenanceRoutingKind = 'COMMON_AREA' | 'PRIVATE_OWNER' | 'PROJECT_MANAGED_PRIVATE';
export type MaintenanceStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_INFO'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED';

export interface TicketImageDto {
  id: string;
  byteSize: number;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface TicketCommentDto {
  id: string;
  authorId: string;
  body: string;
  images: TicketImageDto[];
  createdAt: string;
}

export interface TicketHistoryDto {
  id: string;
  fromState: string;
  toState: string;
  actorId: string | null;
  reason: string | null;
  changedAt: string;
}

export interface TicketDto {
  id: string;
  routingKind: MaintenanceRoutingKind;
  roomId: string | null;
  locationDescription: string;
  subject: string;
  description: string;
  status: MaintenanceStatus;
  version: number;
  reporterId: string;
  images: TicketImageDto[];
  comments: TicketCommentDto[];
  history: TicketHistoryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketCreateDto {
  id: string;
  routingKind: MaintenanceRoutingKind;
  roomId: string | null;
  locationDescription: string;
  subject: string;
  status: MaintenanceStatus;
  version: number;
  images: TicketImageDto[];
  createdAt: string;
}

export interface TicketListEnvelope {
  data: TicketDto[];
  meta: { page: number; pageSize: number; total: number };
}

export interface TicketDetailEnvelope {
  data: TicketDto;
}

export interface TicketCreateEnvelope {
  data: TicketCreateDto;
}

export interface TicketCommentEnvelope {
  data: TicketCommentDto;
}

export interface EligibleRoomsEnvelope {
  data: { roomIds: string[] };
}

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export async function findMaintenanceRoom(page: Page, roomCode: string): Promise<string> {
  for (let sheet = 1; sheet <= 20; sheet += 1) {
    const listed = await apiJson<{ data: Array<{ id: string; roomCode: string }> }>(page.request, {
      method: 'GET',
      path: `/api/rooms?page=${sheet}&pageSize=100`,
    });
    expect(listed.status).toBe(200);
    const found = listed.json.data.find((room) => room.roomCode === roomCode);
    if (found !== undefined) return found.id;
    if (listed.json.data.length < 100) break;
  }
  throw new Error(`Maintenance room ${roomCode} was not found.`);
}

export async function postTicket(
  request: APIRequestContext,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'POST',
    path: '/api/maintenance',
    body,
    ...(idempotencyKey !== undefined ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export async function listTickets(
  request: APIRequestContext,
  query: { roomId?: string; routingKind?: string; status?: string; page?: number; pageSize?: number },
): Promise<{ rows: TicketDto[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (query.roomId !== undefined) params.set('roomId', query.roomId);
  if (query.routingKind !== undefined) params.set('routingKind', query.routingKind);
  if (query.status !== undefined) params.set('status', query.status);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 100));
  const listed = await apiJson<TicketListEnvelope>(request, {
    method: 'GET',
    path: `/api/maintenance?${params.toString()}`,
  });
  expect(listed.status).toBe(200);
  return {
    rows: listed.json.data,
    total: listed.json.meta.total,
    page: listed.json.meta.page,
    pageSize: listed.json.meta.pageSize,
  };
}

export async function listTicketsRaw(
  request: APIRequestContext,
  queryString: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'GET',
    path: `/api/maintenance${queryString}`,
  });
}

export async function getTicket(
  request: APIRequestContext,
  id: string,
): Promise<TicketDto> {
  const detail = await apiJson<TicketDetailEnvelope>(request, {
    method: 'GET',
    path: `/api/maintenance/${id}`,
  });
  expect(detail.status).toBe(200);
  return detail.json.data;
}

export async function getTicketRaw(
  request: APIRequestContext,
  id: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'GET',
    path: `/api/maintenance/${id}`,
  });
}

export async function patchTicket(
  request: APIRequestContext,
  id: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'PATCH',
    path: `/api/maintenance/${id}`,
    body,
  });
}

export async function postTicketComment(
  request: APIRequestContext,
  id: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'POST',
    path: `/api/maintenance/${id}/comments`,
    body,
    ...(idempotencyKey !== undefined ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export async function getEligibleRooms(
  request: APIRequestContext,
  routingKind: string,
): Promise<string[]> {
  const listed = await apiJson<EligibleRoomsEnvelope>(request, {
    method: 'GET',
    path: `/api/maintenance/eligible-rooms?routingKind=${routingKind}`,
  });
  expect(listed.status).toBe(200);
  return listed.json.data.roomIds;
}

export async function getEligibleRoomsRaw(
  request: APIRequestContext,
  queryString: string,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'GET',
    path: `/api/maintenance/eligible-rooms${queryString}`,
  });
}
