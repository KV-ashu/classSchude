import { env } from '../config/env';
import { logger } from '../config/logger';
import { processRawMessageSafely } from '../messages/processing/processor';
import { drainMessageIds, pendingMessageCount } from './processing-queue';

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