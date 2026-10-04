import { logger } from './config/logger';
import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/connection';
import { messageAdapters } from './messages/adapters';
import { attachSocketServer } from './realtime/socket';
import { startIngestionWorker, stopIngestionWorker } from './workers/ingestion.worker';

const app = createApp();

async function start(): Promise<void> {
  // Adapters must be running before the server accepts messages.
  await messageAdapters.start();
  startIngestionWorker();

  try {
    await connectDatabase({ uri: env.MONGODB_URI });
    logger.info('[classsync-server] connected to MongoDB');
  } catch (error) {
    if (env.NODE_ENV === 'production') {
      throw error;
    }
    logger.warn('[classsync-server] could not reach MongoDB - starting in degraded mode.');
    logger.warn('[classsync-server] start MongoDB or set MONGODB_URI, then restart the server.');
    logger.warn(
      `[classsync-server] reason: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const httpServer = createServer(app);
  // Real-time layer shares the HTTP server; rooms are per account.
  attachSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(
      `[classsync-server] listening on http://localhost:${env.PORT} (${env.NODE_ENV}, tz=${env.TZ_DEFAULT})`,
    );
    logger.info(`[classsync-server] health check: http://localhost:${env.PORT}/api/health`);
  });

  function shutdown(signal: NodeJS.Signals): void {
    logger.info(`[classsync-server] ${signal} received - shutting down`);
    void messageAdapters.stop();
    stopIngestionWorker();
    httpServer.close(() => {
      void disconnectDatabase().finally(() => {
        process.exit(0);
      });
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void start().catch((error: unknown) => {
  logger.error({ error }, 'server failed to start');
  process.exit(1);
});
