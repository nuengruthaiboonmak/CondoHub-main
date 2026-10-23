'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export interface ChatSocketSignal {
  kind: 'message' | 'revoked';
  roomId: string;
  messageId: string | null;
  createdAt: string | null;
}

interface SignalPayload {
  roomId?: unknown;
  messageId?: unknown;
  createdAt?: unknown;
}

function isRecord(value: unknown): value is SignalPayload {
  return typeof value === 'object' && value !== null;
}

export function useChatSocket({
  roomId,
  onSignal,
}: {
  roomId: string;
  onSignal: (signal: ChatSocketSignal) => void;
}): { connected: boolean; connectFailed: boolean; everConnected: boolean } {
  const [connected, setConnected] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const handlerRef = useRef(onSignal);
  handlerRef.current = onSignal;

  useEffect(() => {
    const socket: Socket = io({ transports: ['websocket'] });
    setConnected(socket.connected);
    setConnectFailed(false);
    const handleConnect = (): void => {
      setConnected(true);
      setConnectFailed(false);
      setEverConnected(true);
      socket.emit('room.join', { roomId });
    };
    const handleDisconnect = (): void => setConnected(false);
    const handleConnectError = (): void => {
      setConnected(false);
      setConnectFailed(true);
    };
    const handleMessageCreated = (payload: unknown): void => {
      if (!isRecord(payload)) return;
      if (payload.roomId !== roomId) return;
      if (typeof payload.messageId !== 'string' || payload.messageId === '') return;
      const createdAt = typeof payload.createdAt === 'string' ? payload.createdAt : null;
      handlerRef.current({ kind: 'message', roomId, messageId: payload.messageId, createdAt });
    };
    const handleRevoked = (payload: unknown): void => {
      if (!isRecord(payload)) return;
      if (payload.roomId !== roomId) return;
      handlerRef.current({ kind: 'revoked', roomId, messageId: null, createdAt: null });
    };
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('chat.message.created', handleMessageCreated);
    socket.on('access.revoked', handleRevoked);
    if (socket.connected) socket.emit('room.join', { roomId });
    return () => {
      socket.emit('room.leave', { roomId });
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('chat.message.created', handleMessageCreated);
      socket.off('access.revoked', handleRevoked);
      socket.disconnect();
    };
  }, [roomId]);

  return { connected, connectFailed, everConnected };
}
