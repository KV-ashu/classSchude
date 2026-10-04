import type { ClientToServerEvents, ServerToClientEvents } from '@classsync/shared';
import { io, type Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Opens an authenticated connection; the server puts us in our own room. */
export function createAppSocket(token: string): AppSocket {
  return io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
  });
}