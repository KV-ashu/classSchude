import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(
    `[classsync-server] listening on http://localhost:${env.PORT} (${env.NODE_ENV}, tz=${env.TZ_DEFAULT})`,
  );
  console.log(`[classsync-server] health check: http://localhost:${env.PORT}/api/health`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[classsync-server] ${signal} received - shutting down`);
  server.close(() => {
    // Phase 2: also close the MongoDB connection here.
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
