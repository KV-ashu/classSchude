/**
 * Socket.IO event contract shared by server and web.
 * Typed payload definitions are added in Phase 7 when the real-time layer
 * is implemented; the event names are frozen here so both sides stay in sync.
 */
export const SOCKET_EVENTS = {
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_PROCESSING: 'message:processing',
  SCHEDULE_CHANGE_APPLIED: 'schedule:change-applied',
  SCHEDULE_CHANGE_UPDATED: 'schedule:change-updated',
  REVIEW_QUEUED: 'review:queued',
  TIMETABLE_CHANGED: 'timetable:changed',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
