import { env } from '../config/env';
import { logger } from '../config/logger';
import { processRawMessageSafely } from '../messages/processing/processor';
import { listInFlightRawMessages } from '../repositories/raw-message.repository';
import { isDatabaseConnected } from '../db/connection';
import { drainMessageIds, enqueueMessageForProcessing, pendingMessageCount } from './processing-queue';

let timer: NodeJS.Timeout | undefined;
let running = false;

/** Processes every queued message once, in order, isolating failures. */
export async function drainProcessingQueue(): Promise<number> {
  const messageIds = drainMessageIds();
  for (const messageId of messageIds) {
    await processRawMessageSafely(messageId);
  }
  if (messageIds.length > 0) {
    logger.info({ processed: messageIds.length }, 'processing queue drained');
  }
  return messageIds.length;
}

/**
 * Re-enqueues messages stranded in RECEIVED/PROCESSING by a previous run so the
 * worker retries them. Called once at startup - a restart (or an earlier
 * provider outage such as a retired model) can no longer leave messages stuck.
 */
export async function recoverStrandedMessages(): Promise<number> {
  if (!isDatabaseConnected()) {
    return 0;
  }
  const stranded = await listInFlightRawMessages();
  for (const message of stranded) {
    enqueueMessageForProcessing(message.id);
  }
  if (stranded.length > 0) {
    logger.warn({ recovered: stranded.length }, 'recovered in-flight messages at startup');
  }
  return stranded.length;
}

/** Starts the background worker that turns ingested messages into changes. */
export function startIngestionWorker(): void {
  if (running || !env.WORKER_ENABLED) {
    return;
  }
  running = true;
  timer = setInterval(() => {
    void drainProcessingQueue().catch((error: unknown) => {
      logger.error({ error }, 'processing worker cycle failed');
    });
  }, env.WORKER_INTERVAL_MS);
  timer.unref();
  logger.info({ intervalMs: env.WORKER_INTERVAL_MS }, 'ingestion worker started');

  // Self-heal any messages left in flight before this process started.
  void recoverStrandedMessages().catch((error: unknown) => {
    logger.error({ error }, 'startup recovery sweep failed');
  });
}

export function stopIngestionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  running = false;
  logger.info(
    { stillQueued: pendingMessageCount() },
    'ingestion worker stopped',
  );
}