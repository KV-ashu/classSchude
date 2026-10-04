import type {
  MessageProcessedPayload,
  ScheduleChangePayload,
  ServerToClientEvents,
  ClientToServerEvents,
  SocketEventPayloads,
} from '@classsync/shared';
import { SOCKET_EVENTS } from '@classsync/shared';
import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { verifyAccessToken } from '../auth/tokens';
import { env } from '../config/env';
import { findUserById } from '../repositories/user.repository';

type ClassSyncSocket = SocketServer<ClientToServerEvents, ServerToClientEvents>;

let io: ClassSyncSocket | undefined;

/** One room per account: the only fan-out boundary in the app. */
export function roomFor(userId: string): string {
  return `user:${userId}`;
}

/** Attaches Socket.IO to the HTTP server with JWT handshake authentication. */
export function attachSocketServer(httpServer: HttpServer): ClassSyncSocket {
  io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    void (async () => {
      const authToken = socket.handshake.auth?.token;
      if (typeof authToken !== 'string' || authToken.length === 0) {
        next(new Error('UNAUTHORIZED'));
        return;
      }

      try {
        const claims = await verifyAccessToken(authToken);
        const user = await findUserById(claims.userId);
        if (!user) {
          next(new Error('UNAUTHORIZED'));
          return;
        }
        socket.data.userId = user.id;
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    })();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    if (typeof userId === 'string') {
      void socket.join(roomFor(userId));
    }
  });

  return io;
}

/** Minimal emitter view - socket.io's generic emit mapping is stricter than we need. */
interface EventEmitter {
  emit(event: string, payload: unknown): void;
}

function emit<K extends keyof SocketEventPayloads>(
  event: K,
  userId: string,
  payload: SocketEventPayloads[K],
): void {
  const target: EventEmitter | undefined = io?.to(roomFor(userId));
  target?.emit(event, payload);
}

/** Effective schedule changed (time, room or online status). */
export function publishScheduleUpdated(userId: string, payload: ScheduleChangePayload): void {
  emit(SOCKET_EVENTS.SCHEDULE_UPDATED, userId, payload);
}

/** A class was cancelled - the UI strikes it through immediately. */
export function publishScheduleCancelled(userId: string, payload: ScheduleChangePayload): void {
  emit(SOCKET_EVENTS.SCHEDULE_CANCELLED, userId, payload);
}

/** A change needs human review. */
export function publishReviewRequired(userId: string, payload: ScheduleChangePayload): void {
  emit(SOCKET_EVENTS.REVIEW_REQUIRED, userId, payload);
}

/** A queued review item was approved or rejected by the user. */
export function publishReviewResolved(userId: string, payload: ScheduleChangePayload): void {
  emit(SOCKET_EVENTS.REVIEW_RESOLVED, userId, payload);
}

/** An applied change was reverted. */
export function publishChangeReverted(userId: string, payload: ScheduleChangePayload): void {
  emit(SOCKET_EVENTS.CHANGE_REVERTED, userId, payload);
}

/** A message finished processing (applied, queued, rejected or ignored). */
export function publishMessageProcessed(userId: string, payload: MessageProcessedPayload): void {
  emit(SOCKET_EVENTS.MESSAGE_PROCESSED, userId, payload);
}

/** Test seam: drops the server reference. */
export function resetSocketServer(): void {
  io = undefined;
}