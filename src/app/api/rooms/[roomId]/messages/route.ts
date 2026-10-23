import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { isUuid } from '@/shared/utils/idempotency';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  chatListQuery,
  chatSendBody,
  createChatCtx,
  listMessages,
  parseWithFieldErrors,
  sendMessage,
} from '@/modules/room-chat/application/index';
import { emitChatMessageCreated } from '@/modules/room-chat/infrastructure/chatFanOut';

export const dynamic = 'force-dynamic';

function resolveRoomId(params: Record<string, string> | undefined): string {
  const roomId = params?.roomId;
  if (roomId === undefined || !isUuid(roomId)) {
    throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
  }
  return roomId;
}

export const GET = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const roomId = resolveRoomId(await route?.params);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(chatListQuery, {
      before: url.searchParams.get('before') ?? undefined,
      after: url.searchParams.get('after') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    const page = await listMessages(
      ctx.actor,
      {
        roomId,
        ...(query.before !== undefined ? { before: query.before } : {}),
        ...(query.after !== undefined ? { after: query.after } : {}),
        limit: query.limit,
      },
      systemClock.now(),
    );
    return paged(page.messages, page.nextCursor === null ? {} : { nextCursor: page.nextCursor });
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

function roomIdFromPath(request: Request): string {
  const match = new URL(request.url).pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
  return match?.[1] ?? 'unknown';
}

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const roomId = resolveRoomId(await route?.params);
    const body = parseWithFieldErrors(chatSendBody, await request.json());
    const chatCtx = createChatCtx({ requestId: ctx.requestId });
    const result = await sendMessage(
      ctx.actor,
      {
        roomId,
        clientMessageId: body.clientMessageId,
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.imageId !== undefined ? { imageId: body.imageId } : {}),
      },
      chatCtx,
    );
    emitChatMessageCreated({
      roomId,
      messageId: result.message.id,
      createdAt: result.message.createdAt,
    });
    return result.message;
  },
  {
    rateLimit: RATE_LIMIT_PRESETS.chatSend ?? { capacity: 30, windowMs: 60_000 },
    rateLimitKey: (request, actor) =>
      actor === null ? 'chat-send:anonymous' : `chat-send:${actor.userId}:${roomIdFromPath(request)}`,
  },
);
