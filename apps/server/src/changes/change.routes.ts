import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { requireAuth, requireAuthContext } from '../auth/auth.middleware';
import type { ScheduleChangeDocument } from '../models/index';
import { requireObjectIdParam } from '../http/require-object-id-param';
import { getEffectiveDay } from '../timetable/effective.service';
import {
  approveChange,
  listChanges,
  rejectChange,
  revertChange,
} from './change.service';
import {
  effectiveQuerySchema,
  listChangesQuerySchema,
  rejectBodySchema,
  revertBodySchema,
  reviewEditsSchema,
} from './change.schemas';

export const changeRouter = Router();

// Every change endpoint is private.
changeRouter.use(requireAuth);

interface ChangeDto {
  id: string;
  action: string;
  status: string;
  confidence: number;
  occurrenceDate: string;
  rawMessageId: string;
  targetEntryId: string;
  oldValue: unknown;
  newValue: unknown;
  appliedBy: string;
  createdAt: string;
}

function toChangeDto(change: ScheduleChangeDocument): ChangeDto {
  return {
    id: change.id,
    action: change.action,
    status: change.status,
    confidence: change.confidence,
    occurrenceDate: change.occurrenceDate,
    rawMessageId: String(change.rawMessageId),
    targetEntryId: String(change.targetEntryId),
    oldValue: change.oldValue ?? null,
    newValue: change.newValue ?? null,
    appliedBy: change.appliedBy,
    createdAt: change.createdAt.toISOString(),
  };
}

function currentUserId(req: Request): Types.ObjectId {
  return new Types.ObjectId(requireAuthContext(req).userId);
}

changeRouter.get('/', async (req, res) => {
  const userId = currentUserId(req);
  const query = listChangesQuerySchema.parse(req.query);

  const changes = await listChanges(userId, { status: query.status, limit: query.limit });

  res.json({ ok: true, data: changes.map(toChangeDto) });
});

/** Effective timetable for a date (baseline + applied changes). */
changeRouter.get('/effective', async (req, res) => {
  const userId = currentUserId(req);
  const query = effectiveQuerySchema.parse(req.query);

  const day = await getEffectiveDay(userId, query.date);

  res.json({ ok: true, data: day });
});

changeRouter.post('/:id/approve', async (req, res) => {
  const userId = currentUserId(req);
  const edits = reviewEditsSchema.parse(req.body ?? {});

  const change = await approveChange(
    userId,
    requireObjectIdParam(req.params.id, 'change id'),
    edits,
  );

  res.json({ ok: true, data: toChangeDto(change) });
});

changeRouter.post('/:id/reject', async (req, res) => {
  const userId = currentUserId(req);
  const body = rejectBodySchema.parse(req.body ?? {});

  const change = await rejectChange(
    userId,
    requireObjectIdParam(req.params.id, 'change id'),
    body.reason,
  );

  res.json({ ok: true, data: toChangeDto(change) });
});

changeRouter.post('/:id/revert', async (req, res) => {
  const userId = currentUserId(req);
  const body = revertBodySchema.parse(req.body ?? {});

  const change = await revertChange(
    userId,
    requireObjectIdParam(req.params.id, 'change id'),
    body.reason,
  );

  res.json({ ok: true, data: toChangeDto(change) });
});