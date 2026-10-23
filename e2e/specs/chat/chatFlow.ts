import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiJson } from '../../helpers/api';

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  roomId: string;
  senderUserId: string;
  senderName: string;
  senderIsAdmin: boolean;
  clientMessageId: string;
  type: 'TEXT' | 'IMAGE';
  text: string | null;
  imageId: string | null;
  createdAt: string;
}

export interface ChatSendEnvelope {
  data: ChatMessageDto;
}

export interface ChatListEnvelope {
  data: ChatMessageDto[];
  meta: { nextCursor?: string };
}

export interface ChatErrorEnvelope {
  error: { code: string; message: string };
}

export async function findChatRoom(page: Page, roomCode: string): Promise<string> {
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
  throw new Error(`Chat room ${roomCode} was not found.`);
}

export async function postMessage(
  request: APIRequestContext,
  roomId: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'POST',
    path: `/api/rooms/${roomId}/messages`,
    body,
  });
}

export async function listMessages(
  request: APIRequestContext,
  roomId: string,
  queryString = '',
): Promise<{ status: number; json: unknown }> {
  return apiJson<unknown>(request, {
    method: 'GET',
    path: `/api/rooms/${roomId}/messages${queryString}`,
  });
}

export function asChatList(json: unknown): ChatListEnvelope {
  return json as ChatListEnvelope;
}

export function asChatSend(json: unknown): ChatSendEnvelope {
  return json as ChatSendEnvelope;
}

export function asChatError(json: unknown): ChatErrorEnvelope {
  return json as ChatErrorEnvelope;
}
