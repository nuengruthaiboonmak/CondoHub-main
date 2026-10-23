import type { Server as SocketServer } from 'socket.io';

export type RevokeFanOut = (input: { userId: string; reason: 'SUSPEND' | 'RESET' | 'PASSWORD_CHANGE' }) => void;

const GLOBAL_KEY = '__condohub_revoke_fanout__';

interface RevokeFanOutStore {
  current: RevokeFanOut;
}

function store(): RevokeFanOutStore {
  const holder = globalThis as unknown as Record<string, RevokeFanOutStore | undefined>;
  const existing = holder[GLOBAL_KEY];
  if (existing !== undefined) return existing;
  const created: RevokeFanOutStore = { current: () => {} };
  holder[GLOBAL_KEY] = created;
  return created;
}

export function setRevokeFanOut(fanOut: RevokeFanOut): void {
  store().current = fanOut;
}

export function emitRevokeFanOut(input: { userId: string; reason: 'SUSPEND' | 'RESET' | 'PASSWORD_CHANGE' }): void {
  store().current(input);
}

export function createSocketRevokeFanOut(io: SocketServer): RevokeFanOut {
  return (input) => {
    void io.fetchSockets().then((sockets) => {
      for (const socket of sockets) {
        if (socket.data.userId === input.userId) socket.disconnect(true);
      }
    });
  };
}
