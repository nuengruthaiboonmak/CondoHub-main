import { assertSeedAllowed, loadDotenv } from './seed-common';

loadDotenv('.env.local');

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function probeConversation(roomCode: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { roomConversation } = await import('@/modules/room-chat/infrastructure/schema');
  const { room } = await import('@/modules/property-membership/infrastructure/schema');
  const { eq } = await import('drizzle-orm');
  const rooms = await db.select().from(room).where(eq(room.roomCode, roomCode)).limit(1);
  const found = rooms[0];
  if (found === undefined) {
    console.log(JSON.stringify({ roomCode, conversation: null, messageCount: 0 }));
    return;
  }
  const conversations = await db
    .select()
    .from(roomConversation)
    .where(eq(roomConversation.roomId, found.id))
    .limit(1);
  const conversation = conversations[0];
  if (conversation === undefined) {
    console.log(JSON.stringify({ roomCode, roomId: found.id, conversation: null, messageCount: 0 }));
    return;
  }
  const { chatMessage } = await import('@/modules/room-chat/infrastructure/schema');
  const rows = await db
    .select({ id: chatMessage.id })
    .from(chatMessage)
    .where(eq(chatMessage.conversationId, conversation.id));
  console.log(
    JSON.stringify({
      roomCode,
      roomId: found.id,
      conversation: { id: conversation.id },
      messageCount: rows.length,
    }),
  );
}

async function probeMessageCount(roomCode: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { chatMessage, roomConversation } = await import('@/modules/room-chat/infrastructure/schema');
  const { room } = await import('@/modules/property-membership/infrastructure/schema');
  const { eq, inArray } = await import('drizzle-orm');
  const rooms = await db.select().from(room).where(eq(room.roomCode, roomCode)).limit(1);
  const found = rooms[0];
  if (found === undefined) {
    console.log(JSON.stringify({ roomCode, count: 0 }));
    return;
  }
  const conversations = await db
    .select({ id: roomConversation.id })
    .from(roomConversation)
    .where(eq(roomConversation.roomId, found.id));
  if (conversations.length === 0) {
    console.log(JSON.stringify({ roomCode, count: 0 }));
    return;
  }
  const rows = await db
    .select({ id: chatMessage.id })
    .from(chatMessage)
    .where(
      inArray(
        chatMessage.conversationId,
        conversations.map((entry) => entry.id),
      ),
    );
  console.log(JSON.stringify({ roomCode, count: rows.length }));
}

async function probeMessage(messageId: string): Promise<void> {
  const { db } = await import('@/shared/db/client');
  const { chatMessage, roomConversation } = await import('@/modules/room-chat/infrastructure/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await db.select().from(chatMessage).where(eq(chatMessage.id, messageId)).limit(1);
  const message = rows[0];
  if (message === undefined) {
    console.log(JSON.stringify({ messageId, message: null }));
    return;
  }
  const conversations = await db
    .select()
    .from(roomConversation)
    .where(eq(roomConversation.id, message.conversationId))
    .limit(1);
  const conversation = conversations[0];
  console.log(
    JSON.stringify({
      messageId,
      message: {
        roomId: conversation?.roomId ?? null,
        conversationId: message.conversationId,
        senderUserId: message.senderUserId,
        clientMessageId: message.clientMessageId,
        type: message.type,
        hasText: message.text !== null,
        imageId: message.imageId,
        createdAt: message.createdAt.toISOString(),
      },
    }),
  );
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === 'probe-conversation') {
    const roomCode = flagValue(argv, '--room');
    if (roomCode === undefined || roomCode === '') throw new Error('Missing required --room <room-code>.');
    await probeConversation(roomCode);
    return;
  }
  if (command === 'probe-message-count') {
    const roomCode = flagValue(argv, '--room');
    if (roomCode === undefined || roomCode === '') throw new Error('Missing required --room <room-code>.');
    await probeMessageCount(roomCode);
    return;
  }
  if (command === 'probe-message') {
    const messageId = flagValue(argv, '--message');
    if (messageId === undefined || messageId === '') throw new Error('Missing required --message <id>.');
    await probeMessage(messageId);
    return;
  }
  throw new Error(`Unknown chat-ops command: ${command ?? '(none)'}.`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    const cause = error instanceof Error ? error.cause : undefined;
    const detail = cause instanceof Error ? ` cause=${cause.message}` : '';
    console.error(`${error instanceof Error ? error.message : String(error)}${detail}`);
    process.exit(1);
  },
);
