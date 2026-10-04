/**
 * Socket.IO contract shared by the API server and the web client.
 *
 * Every payload is typed on both sides, so an event rename breaks the build
 * instead of silently rotting in the browser.
 */
export const SOCKET_EVENTS = {
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_PROCESSED: 'message:processed',
  SCHEDULE_UPDATED: 'schedule.updated',
  SCHEDULE_CANCELLED: 'schedule.cancelled',
  REVIEW_REQUIRED: 'schedule.reviewRequired',
  REVIEW_RESOLVED: 'review.resolved',
  CHANGE_REVERTED: 'change.reverted',
} as const;

export interface ScheduleChangePayload {
  changeId: string | null;
  entryId: string | null;
  occurrenceDate: string | null;
  courseCode: string | null;
  action: string | null;
  confidence: number | null;
  status: string | null;
  reason: string | null;
}

export interface MessageProcessedPayload {
  messageId: string;
  status: string;
  changes: { action: string; decision: string; courseCode: string | null }[];
}

export interface SocketEventPayloads {
  'message:received': { messageId: string; sourceKind: string };
  'message:processed': MessageProcessedPayload;
  'schedule.updated': ScheduleChangePayload;
  'schedule.cancelled': ScheduleChangePayload;
  'schedule.reviewRequired': ScheduleChangePayload;
  'review.resolved': ScheduleChangePayload;
  'change.reverted': ScheduleChangePayload;
}

export type ServerToClientEvents = {
  [K in keyof SocketEventPayloads]: (payload: SocketEventPayloads[K]) => void;
};

export type ClientToServerEvents = {
  'socket:ready': () => void;
};

export type SocketEventName = keyof SocketEventPayloads;
