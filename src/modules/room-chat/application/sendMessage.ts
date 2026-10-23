import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { IMAGE_COUNT_CAPS } from '@/config/imageLimits';
import { commitAttachments } from '@/modules/media-attachments/application/index';
import {
  canActInRoom,
  getResidentIntervals,
} from '@/modules/property-membership/application/index';
import { getSenderProfile } from '@/modules/identity-access/application/index';
import { decideChatAction } from '../domain/chatPolicy';
import {
  assertMessageContentValid,
  buildSenderSnapshot,
  parseSenderSnapshot,
} from '../domain/messageSend';
import { messageVisibleAt } from '../domain/visibility';
import {
  findMessageByClientKey,
  insertConversationForRoom,
  insertMessageIdempotent,
  type MessageRecord,
} from '../infrastructure/chatRepository';
import type { ChatCtx } from './ctx';

export interface SendMessageInput {
  roomId: string;
  clientMessageId: string;
  text?: string | null | undefined;
  imageId?: string | null | undefined;
}

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

export interface SendMessageResult {
  message: ChatMessageDto;
  inserted: boolean;
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

async function assertCurrentRoomAccess(actor: Actor, roomId: string, at: Date): Promise<void> {
  if (actor.isSystemAdmin) return;
  const verdict = await canActInRoom(actor.userId, roomId, 'SEND_CHAT', at).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    },
  );
  if (verdict === null) throw new AppError('RESOURCE_NOT_FOUND');
  decideChatAction({ actorIsSystemAdmin: false, actorHasCurrentRoomAccess: verdict.allowed }, 'SEND_CHAT');
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

async function replayMessage(
  conn: Db,
  actor: Actor,
  roomId: string,
  conversationId: string,
  clientMessageId: string,
  now: Date,
): Promise<ChatMessageDto> {
  const existing = await findMessageByClientKey(conn, {
    conversationId,
    senderUserId: actor.userId,
    clientMessageId,
  });
  if (existing === null) throw new AppError('RATE_LIMITED');
  if (!actor.isSystemAdmin) {
    const intervals = await getResidentIntervals(actor.userId, roomId);
    if (!messageVisibleAt(intervals, existing.createdAt)) throw new AppError('RESOURCE_NOT_FOUND');
  }
  void now;
  return toDto(existing, roomId);
}

export async function sendMessage(
  actor: Actor,
  input: SendMessageInput,
  ctx: ChatCtx,
  conn: Db = db,
): Promise<SendMessageResult> {
  assertActive(actor);
  const content = assertMessageContentValid({
    text: input.text ?? null,
    imageId: input.imageId ?? null,
  });
  const now = ctx.clock.now();
  await assertCurrentRoomAccess(actor, input.roomId, now);
  const profile = await getSenderProfile(actor.userId);
  const snapshot = buildSenderSnapshot({ name: profile.name, isAdmin: profile.isSystemAdmin });
  const imageIds = content.imageId === null ? [] : [content.imageId];
  try {
    return await conn.transaction(async (tx) => {
      await assertCurrentRoomAccess(actor, input.roomId, now);
      const conversation = await insertConversationForRoom(tx, input.roomId);
      const outcome = await insertMessageIdempotent(tx, {
        conversationId: conversation.id,
        senderUserId: actor.userId,
        clientMessageId: input.clientMessageId,
        senderSnapshot: { name: snapshot.name, isAdmin: snapshot.isAdmin },
        type: content.type,
        text: content.text,
        imageId: content.imageId,
        createdAt: now,
      });
      if (!outcome.inserted) {
        const replayed = await replayMessage(
          tx,
          actor,
          input.roomId,
          conversation.id,
          input.clientMessageId,
          now,
        );
        return { message: replayed, inserted: false };
      }
      await commitAttachments(tx, actor, {
        scope: 'CHAT',
        entityRef: { type: 'chat_message', id: outcome.record.id },
        imageIds,
        maxCount: IMAGE_COUNT_CAPS.SEND_CHAT_MESSAGE.max,
        at: now,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'chat_message.created',
        resourceType: 'chat_message',
        resourceId: outcome.record.id,
        requestId: ctx.requestId,
        after: {
          roomId: input.roomId,
          conversationId: conversation.id,
          type: outcome.record.type,
          hasImage: outcome.record.imageId !== null,
        },
        at: now,
      });
      return { message: toDto(outcome.record, input.roomId), inserted: true };
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        chat_message_sender_key_uq: 'INTERNAL_ERROR',
      },
      fallbackCodes: {
        '23503': 'VALIDATION_ERROR',
      },
    });
  }
}
