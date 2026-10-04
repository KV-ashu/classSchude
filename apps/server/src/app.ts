import cors from 'cors';
import express, { type Express } from 'express';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handlers';
import { healthRouter } from './routes/health';

/**
 * Builds the Express application. Kept separate from the HTTP listener so
 * tests can exercise it with supertest without binding a port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);

  // Phase 4+ mounts ingestion, review and change endpoints here.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
