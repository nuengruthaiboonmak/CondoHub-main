import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from '@/modules/identity-access/infrastructure/betterAuthSchema';
import { room } from '@/modules/property-membership/infrastructure/schema';
import { imageAttachment } from '@/modules/media-attachments/infrastructure/schema';

export const chatMessageType = pgEnum('chat_message_type', ['TEXT', 'IMAGE']);

export type ChatMessageType = (typeof chatMessageType.enumValues)[number];

export const roomConversation = pgTable(
  'room_conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('room_conversation_room_uq').on(table.roomId)],
);

export type RoomConversationRow = typeof roomConversation.$inferSelect;
export type RoomConversationInsert = typeof roomConversation.$inferInsert;

export const chatMessage = pgTable(
  'chat_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => roomConversation.id, { onDelete: 'restrict' }),
    senderUserId: text('sender_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    clientMessageId: uuid('client_message_id').notNull(),
    senderSnapshot: jsonb('sender_snapshot').notNull().default({}),
    type: chatMessageType('type').notNull(),
    text: text('text'),
    imageId: uuid('image_id').references(() => imageAttachment.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('chat_message_sender_key_uq').on(
      table.conversationId,
      table.senderUserId,
      table.clientMessageId,
    ),
    check(
      'chat_message_text_or_image_ck',
      sql`"text" IS NOT NULL OR "image_id" IS NOT NULL`,
    ),
    index('chat_message_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
  ],
);

export type ChatMessageRow = typeof chatMessage.$inferSelect;
export type ChatMessageInsert = typeof chatMessage.$inferInsert;
