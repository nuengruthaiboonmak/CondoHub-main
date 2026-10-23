import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { eq } from 'drizzle-orm';
import { AppError } from '@/shared/utils/errors';
import { decodeCursor, encodeCursor } from '@/shared/utils/pagination';
import {
  canActInRoom,
  getResidentIntervals,
} from '@/modules/property-membership/application/index';
import { decideChatAction } from '../domain/chatPolicy';
import { parseSenderSnapshot } from '../domain/messageSend';
import { visibleSlices } from '../domain/visibility';
import { roomConversation } from '../infrastructure/schema';
import {
  findConversationByRoom,
  findMessageById,
  listMessagesByCursor,
  type MessageRecord,
  type VisibilitySlice,
} from '../infrastructure/chatRepository';
import type { ChatMessageDto } from './sendMessage';

export interface ListMessagesInput {
  roomId: string;
  before?: string | undefined;
  after?: string | undefined;
  limit: number;
}

export interface ChatMessagePage {
  messages: ChatMessageDto[];
  nextCursor: string | null;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

function toDto(record: MessageRecord, roomId: string): ChatMessageDto {
  const snapshot = parseSenderSnapshot(record.senderSnapshot);
  return {
    id: record.id,
    conversationId: record.conversationId,
    roomId,
    senderUserId: record.senderUserId,
    senderName: snapshot.name,
    senderIsAdmin: snapshot.isAdmin,
    clientMessageId: record.clientMessageId,
    type: record.type,
    text: record.text,
    imageId: record.imageId,
    createdAt: record.createdAt.toISOString(),
  };
}

function toPosition(cursor: string): { createdAt: Date; id: string } {
  const decoded = decodeCursor(cursor);
  return { createdAt: new Date(decoded.createdAt), id: decoded.id };
}

function encodePosition(record: MessageRecord): string {
  return encodeCursor({ createdAt: record.createdAt, id: record.id });
}

async function resolveSlices(
  actor: Actor,
  roomId: string,
  at: Date,
): Promise<{ slices: VisibilitySlice[] | undefined; denied: boolean }> {
  if (actor.isSystemAdmin) return { slices: undefined, denied: false };
  const verdict = await canActInRoom(actor.userId, roomId, 'VIEW_CHAT', at).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    },
  );
  if (verdict === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (!verdict.allowed) return { slices: [], denied: true };
  const intervals = await getResidentIntervals(actor.userId, roomId);
  return { slices: visibleSlices({ intervals, rangeStart: null, rangeEnd: null }), denied: false };
}

export async function listMessages(
  actor: Actor,
  input: ListMessagesInput,
  now: Date,
  conn: Db = db,
): Promise<ChatMessagePage> {
  assertActive(actor);
  if (input.before !== undefined && input.after !== undefined) {
    throw new AppError('VALIDATION_ERROR', 'Only one of before or after may be provided.');
  }
  if (!actor.isSystemAdmin) {
    const verdict = await canActInRoom(actor.userId, input.roomId, 'VIEW_CHAT', now).catch(
      (error: unknown) => {
        if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
        throw error;
      },
    );
    if (verdict === null) throw new AppError('RESOURCE_NOT_FOUND');
    decideChatAction(
      { actorIsSystemAdmin: false, actorHasCurrentRoomAccess: verdict.allowed },
      'VIEW_CHAT',
    );
  }
  const conversation = await findConversationByRoom(conn, input.roomId);
  if (conversation === null) return { messages: [], nextCursor: null };
  const { slices } = await resolveSlices(actor, input.roomId, now);
  if (slices !== undefined && slices.length === 0) return { messages: [], nextCursor: null };
  const before = input.before === undefined ? undefined : toPosition(input.before);
  const after = input.after === undefined ? undefined : toPosition(input.after);
  const page = await listMessagesByCursor(conn, {
    conversationId: conversation.id,
    limit: input.limit,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(slices !== undefined ? { slices } : {}),
  });
  const rows = page.rows.slice(0, input.limit);
  const hasMore = page.rows.length > input.limit;
  const messages = rows;
  if (!hasMore) {
    return { messages: messages.map((row) => toDto(row, input.roomId)), nextCursor: null };
  }
  const edge = rows[rows.length - 1];
  if (edge === undefined) return { messages: [], nextCursor: null };
  return {
    messages: messages.map((row) => toDto(row, input.roomId)),
    nextCursor: encodePosition(edge),
  };
}

export async function resolveMessageRoom(
  messageId: string,
  conn: Db = db,
): Promise<{ roomId: string; message: MessageRecord } | null> {
  const message = await findMessageById(conn, messageId);
  if (message === null) return null;
  const rows = await conn
    .select()
    .from(roomConversation)
    .where(eq(roomConversation.id, message.conversationId))
    .limit(1);
  const conversation = rows[0];
  if (conversation === undefined) return null;
  return { roomId: conversation.roomId, message };
}
