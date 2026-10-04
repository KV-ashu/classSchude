import type { MessageEvent } from '@classsync/shared';

export interface QueuedMessageEvent {
  event: MessageEvent;
  enqueuedAt: Date;
}

const pending: QueuedMessageEvent[] = [];

/**
 * In-process queue for adapter-delivered events. This is the seam where the
 * Phase 5 processing pipeline attaches: adapters publish, the pipeline drains.
 */
export function enqueueMessageEvent(event: MessageEvent): void {
  pending.push({ event, enqueuedAt: new Date() });
}

/** Removes and returns every queued event (FIFO). */
export function drainMessageEvents(): QueuedMessageEvent[] {
  return pending.splice(0, pending.length);
}

export function pendingMessageEventCount(): number {
  return pending.length;
}

export function clearMessageEventQueue(): void {
  pending.length = 0;
}