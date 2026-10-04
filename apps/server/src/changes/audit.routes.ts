import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth, requireAuthContext } from '../auth/auth.middleware';
import { listAuditLogByUser } from '../repositories/audit-log.repository';

export const auditRouter = Router();

auditRouter.use(requireAuth);

interface AuditEntryDto {
  id: string;
  actor: string;
  action: string;
  changeId: string | null;
  occurrenceDate: string | null;
  reason: string | null;
  createdAt: string;
}

auditRouter.get('/', async (req, res) => {
  const userId = new Types.ObjectId(requireAuthContext(req).userId) as Types.ObjectId;

  const entries = await listAuditLogByUser(userId, 100);

  const data: AuditEntryDto[] = entries.map((entry) => ({
    id: entry.id,
    actor: entry.actor,
    action: entry.action,
    changeId: entry.changeId ? String(entry.changeId) : null,
    occurrenceDate: entry.occurrenceDate ?? null,
    reason: entry.reason ?? null,
    createdAt: entry.createdAt.toISOString(),
  }));

  res.json({ ok: true, data });
});