import { Router } from 'express';
import { isDatabaseConnected } from '../db/connection';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'classsync-server',
    uptimeSeconds: Math.round(process.uptime()),
    db: isDatabaseConnected() ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});
