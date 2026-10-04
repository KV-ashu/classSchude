import cors from 'cors';
import express, { type Express } from 'express';
import { authRouter } from './auth/auth.routes';
import { env } from './config/env';
import { courseRouter } from './courses/course.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handlers';
import { healthRouter } from './routes/health';
import { timetableRouter } from './timetable/timetable.routes';

/**
 * Builds the Express application. Kept separate from the HTTP listener so
 * tests can exercise it with supertest without binding a port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));

  // Base64 timetable photos are large: a roomier parser runs before the global one.
  app.use('/api/timetable/import/image', express.json({ limit: '25mb' }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/courses', courseRouter);
  app.use('/api/timetable', timetableRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
