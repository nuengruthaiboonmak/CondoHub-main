import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { auth } from '@/modules/identity-access/infrastructure/betterAuth';
import { env } from '@/config/env';
import { logger } from '@/shared/observability/logger';

export interface RoomJoinPayload {
  roomId?: unknown;
}

export type RoomJoinAuthorizer = (userId: string, roomId: string) => Promise<boolean>;

export const P1_WIRING_ROOM_JOIN = 'P1-WIRING';

export const denyAllRoomJoins: RoomJoinAuthorizer = async () => false;

export function attachSocket(
  httpServer: HttpServer,
  roomJoinAuthorizer: RoomJoinAuthorizer = denyAllRoomJoins,
): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: env.APP_BASE_URL },
  });

  io.use(async (socket, next) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(socket.handshake.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) {
          for (const entry of value) headers.append(name, entry);
        }
      }
      const session = await auth.api.getSession({ headers });
      if (session === null) return next(new Error('unauthorized'));
      const user = session.user as { id: string; accountStatus?: unknown; mustChangePassword?: unknown };
      if (user.accountStatus !== 'ACTIVE' || user.mustChangePassword === true) {
        return next(new Error('unauthorized'));
      }
      socket.data.userId = user.id;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'socket connected');
    socket.on('room.join', async (payload: RoomJoinPayload) => {
      if (typeof payload?.roomId !== 'string' || payload.roomId === '') return;
      const userId = socket.data.userId as string | undefined;
      if (userId === undefined || userId === '') return;
      const allowed = await roomJoinAuthorizer(userId, payload.roomId);
      if (!allowed) return;
      socket.join(payload.roomId);
    });
    socket.on('room.leave', (payload: RoomJoinPayload) => {
      if (typeof payload?.roomId !== 'string' || payload.roomId === '') return;
      socket.leave(payload.roomId);
    });
  });

  return io;
}

export function notifyMessageCreated(
  io: SocketServer,
  input: { roomId: string; messageId: string; createdAt: string },
): void {
  io.to(input.roomId).emit('chat.message.created', input);
}

export function notifyAccessRevoked(io: SocketServer, roomId: string): void {
  io.to(roomId).emit('access.revoked', { roomId });
  void io.in(roomId).socketsLeave(roomId);
}
