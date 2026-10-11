import cors from 'cors';
import express, { type Express } from 'express';
import { authRouter } from './auth/auth.routes';
import { env } from './config/env';
import { auditRouter } from './changes/audit.routes';
import { changeRouter } from './changes/change.routes';
import { courseRouter } from './courses/course.routes';
import { messageRouter } from './messages/message.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handlers';
import { healthRouter } from './routes/health';
import { timetableRouter } from './timetable/timetable.routes';
import { whatsappWebhookRouter } from './webhooks/whatsapp.routes';

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
  // Twilio webhooks arrive as application/x-www-form-urlencoded (Body/From/...).
  app.use('/api/webhook', express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/courses', courseRouter);
  app.use('/api/timetable', timetableRouter);
  app.use('/api/messages', messageRouter);
  app.use('/api/webhook', whatsappWebhookRouter);
  app.use('/api/changes', changeRouter);
  app.use('/api/audit', auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
