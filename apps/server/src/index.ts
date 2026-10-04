import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/connection';
import { messageAdapters } from './messages/adapters';

const app = createApp();

async function start(): Promise<void> {
  // Adapters must be running before the server accepts messages.
  await messageAdapters.start();

  try {
    await connectDatabase({ uri: env.MONGODB_URI });
    console.log('[classsync-server] connected to MongoDB');
  } catch (error) {
    if (env.NODE_ENV === 'production') {
      throw error;
    }
    console.warn('[classsync-server] could not reach MongoDB - starting in degraded mode.');
    console.warn('[classsync-server] start MongoDB or set MONGODB_URI, then restart the server.');
    console.warn(
      `[classsync-server] reason: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const server = app.listen(env.PORT, () => {
    console.log(
      `[classsync-server] listening on http://localhost:${env.PORT} (${env.NODE_ENV}, tz=${env.TZ_DEFAULT})`,
    );
    console.log(`[classsync-server] health check: http://localhost:${env.PORT}/api/health`);
  });

  function shutdown(signal: NodeJS.Signals): void {
    console.log(`[classsync-server] ${signal} received - shutting down`);
    void messageAdapters.stop();
    server.close(() => {
      void disconnectDatabase().finally(() => {
        process.exit(0);
      });
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void start().catch((error: unknown) => {
  console.error('[classsync-server] failed to start:', error);
  process.exit(1);
});
