import 'server-only';
import { and, asc, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import {
  chatMessage,
  roomConversation,
  type ChatMessageType,
} from './schema';

export interface ConversationRecord {
  id: string;
  roomId: string;
  createdAt: Date;
}

function toConversation(row: typeof roomConversation.$inferSelect): ConversationRecord {
  return { id: row.id, roomId: row.roomId, createdAt: row.createdAt };
}

export async function findConversationByRoom(
  conn: Db,
  roomId: string,
): Promise<ConversationRecord | null> {
  const rows = await conn
    .select()
    .from(roomConversation)
    .where(eq(roomConversation.roomId, roomId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toConversation(row);
}

export async function insertConversationForRoom(
  tx: Tx,
  roomId: string,
): Promise<ConversationRecord> {
  const rows = await tx
    .insert(roomConversation)
    .values({ roomId })
    .onConflictDoNothing({ target: [roomConversation.roomId] })
    .returning();
  const row = rows[0];
  if (row !== undefined) return toConversation(row);
  const existing = await tx
    .select()
    .from(roomConversation)
    .where(eq(roomConversation.roomId, roomId))
    .limit(1);
  const found = existing[0];
  if (found === undefined) throw new Error('Conversation idempotent insert found no row.');
  return toConversation(found);
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderUserId: string;
  clientMessageId: string;
  senderSnapshot: unknown;
  type: ChatMessageType;
  text: string | null;
  imageId: string | null;
  createdAt: Date;
}

function toRecord(row: typeof chatMessage.$inferSelect): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderUserId: row.senderUserId,
    clientMessageId: row.clientMessageId,
    senderSnapshot: row.senderSnapshot,
    type: row.type,
    text: row.text,
    imageId: row.imageId,
    createdAt: row.createdAt,
  };
}

export async function findMessageById(conn: Db, id: string): Promise<MessageRecord | null> {
  const rows = await conn.select().from(chatMessage).where(eq(chatMessage.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function findMessageByClientKey(
  conn: Db,
  input: { conversationId: string; senderUserId: string; clientMessageId: string },
): Promise<MessageRecord | null> {
  const rows = await conn
    .select()
    .from(chatMessage)
    .where(
      and(
        eq(chatMessage.conversationId, input.conversationId),
        eq(chatMessage.senderUserId, input.senderUserId),
        eq(chatMessage.clientMessageId, input.clientMessageId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function insertMessageIdempotent(
  tx: Tx,
  input: {
    conversationId: string;
    senderUserId: string;
    clientMessageId: string;
    senderSnapshot: Record<string, unknown>;
    type: ChatMessageType;
    text: string | null;
    imageId: string | null;
    createdAt: Date;
  },
): Promise<{ record: MessageRecord; inserted: boolean }> {
  const rows = await tx
    .insert(chatMessage)
    .values({
      conversationId: input.conversationId,
      senderUserId: input.senderUserId,
      clientMessageId: input.clientMessageId,
      senderSnapshot: input.senderSnapshot,
      type: input.type,
      text: input.text,
      imageId: input.imageId,
      createdAt: input.createdAt,
    })
    .onConflictDoNothing({
      target: [
        chatMessage.conversationId,
        chatMessage.senderUserId,
        chatMessage.clientMessageId,
      ],
    })
    .returning();
  const row = rows[0];
  if (row !== undefined) return { record: toRecord(row), inserted: true };
  const existing = await findMessageByClientKey(tx, {
    conversationId: input.conversationId,
    senderUserId: input.senderUserId,
    clientMessageId: input.clientMessageId,
  });
  if (existing === null) throw new Error('Message idempotent insert found no row.');
  return { record: existing, inserted: false };
}

export interface VisibilitySlice {
  start: Date;
  end: Date | null;
}

function sliceCondition(slice: VisibilitySlice) {
  if (slice.end === null) {
    return sql`${chatMessage.createdAt} >= ${slice.start}`;
  }
  return sql`${chatMessage.createdAt} >= ${slice.start} AND ${chatMessage.createdAt} < ${slice.end}`;
}

export interface CursorPageInput {
  conversationId: string;
  limit: number;
  before?: { createdAt: Date; id: string } | undefined;
  after?: { createdAt: Date; id: string } | undefined;
  slices?: VisibilitySlice[] | undefined;
}

export interface CursorPage {
  rows: MessageRecord[];
}

export async function listMessagesByCursor(conn: Db, input: CursorPageInput): Promise<CursorPage> {
  const conditions = [eq(chatMessage.conversationId, input.conversationId)];
  if (input.before !== undefined) {
    conditions.push(
      or(
        lt(chatMessage.createdAt, input.before.createdAt),
        and(
          eq(chatMessage.createdAt, input.before.createdAt),
          lt(chatMessage.id, input.before.id),
        ),
      )!,
    );
  }
  if (input.after !== undefined) {
    conditions.push(
      or(
        gt(chatMessage.createdAt, input.after.createdAt),
        and(
          eq(chatMessage.createdAt, input.after.createdAt),
          gt(chatMessage.id, input.after.id),
        ),
      )!,
    );
  }
  if (input.slices !== undefined) {
    if (input.slices.length === 0) return { rows: [] };
    conditions.push(or(...input.slices.map((slice) => sliceCondition(slice)))!);
  }
  const where = and(...conditions);
  if (input.after === undefined) {
    const rows = await conn
      .select()
      .from(chatMessage)
      .where(where)
      .orderBy(desc(chatMessage.createdAt), desc(chatMessage.id))
      .limit(input.limit + 1);
    return { rows: rows.map(toRecord) };
  }
  const rows = await conn
    .select()
    .from(chatMessage)
    .where(where)
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id))
    .limit(input.limit + 1);
  return { rows: rows.map(toRecord) };
}
