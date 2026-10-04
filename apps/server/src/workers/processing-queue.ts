/**
 * Queue of ingested messages waiting for the processing pipeline.
 * The adapters deliver events; the API persists them; this queue is what the
 * background worker drains. Keeping message ids (not payloads) means the worker
 * always reads the current state from the database.
 */
const pendingMessageIds: string[] = [];

export function enqueueMessageForProcessing(messageId: string): void {
  pendingMessageIds.push(messageId);
}

export function drainMessageIds(): string[] {
  return pendingMessageIds.splice(0, pendingMessageIds.length);
}

export function pendingMessageCount(): number {
  return pendingMessageIds.length;
}

export function clearProcessingQueue(): void {
  pendingMessageIds.length = 0;
}