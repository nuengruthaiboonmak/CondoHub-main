import 'server-only';
import type { Server as SocketServer } from 'socket.io';

export type MessageCreatedSignal = {
  roomId: string;
  messageId: string;
  createdAt: string;
};

export interface ChatSignalFanOut {
  messageCreated: (signal: MessageCreatedSignal) => void;
  accessRevoked: (roomId: string) => void;
}

const GLOBAL_KEY = '__condohub_chat_signal_fanout__';

function store(): ChatSignalFanOut {
  const holder = globalThis as unknown as Record<string, ChatSignalFanOut | undefined>;
  const existing = holder[GLOBAL_KEY];
  if (existing !== undefined) return existing;
  const created: ChatSignalFanOut = {
    messageCreated: () => {},
    accessRevoked: () => {},
  };
  holder[GLOBAL_KEY] = created;
  return created;
}

export function setChatSignalFanOut(fanOut: ChatSignalFanOut): void {
  const target = store();
  target.messageCreated = fanOut.messageCreated;
  target.accessRevoked = fanOut.accessRevoked;
}

export function emitChatMessageCreated(signal: MessageCreatedSignal): void {
  store().messageCreated(signal);
}

export function emitChatAccessRevoked(roomId: string): void {
  store().accessRevoked(roomId);
}

export function createSocketChatFanOut(io: SocketServer): {
  messageCreated: (signal: MessageCreatedSignal) => void;
  accessRevoked: (roomId: string) => void;
} {
  return {
    messageCreated: (signal) => {
      io.to(signal.roomId).emit('chat.message.created', signal);
    },
    accessRevoked: (roomId) => {
      io.to(roomId).emit('access.revoked', { roomId });
      void io.in(roomId).socketsLeave(roomId);
    },
  };
}
