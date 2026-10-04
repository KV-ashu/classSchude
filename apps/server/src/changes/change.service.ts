import type { ChangeStatus, ScheduleChangePayload } from '@classsync/shared';
import type { Types } from 'mongoose';
import { ApiError } from '../errors';
import {
  ScheduleChange,
  type AuditEntrySnapshot,
  type ScheduleChangeDocument,
} from '../models/index';
import { appendAuditLog } from '../repositories/audit-log.repository';
import {
  publishChangeReverted,
  publishReviewResolved,
  publishScheduleCancelled,
  publishScheduleUpdated,
} from '../realtime/socket';

export interface ListChangesOptions {
  status?: ChangeStatus;
  limit?: number;
}

/** Corrections a reviewer may apply before approving. */
export interface ReviewEdits {
  occurrenceDate?: string;
  startTime?: string;
  endTime?: string;
  room?: string | null;
}

async function requireOwnedChange(
  changeId: string,
  userId: Types.ObjectId,
): Promise<ScheduleChangeDocument> {
  const change = await ScheduleChange.findById(changeId);
  if (!change || !change.userId.equals(userId)) {
    throw ApiError.notFound('Schedule change not found');
  }
  return change;
}

function snapshotFrom(value: ScheduleChangeDocument['newValue']): AuditEntrySnapshot {
  return {
    startTime: value?.startTime,
    endTime: value?.endTime,
    room: value?.room ?? null,
    kind: value?.kind,
  };
}

export async function listChanges(
  userId: Types.ObjectId,
  options: ListChangesOptions = {},
): Promise<ScheduleChangeDocument[]> {
  const filter: { userId: Types.ObjectId; status?: ChangeStatus } = { userId };
  if (options.status) {
    filter.status = options.status;
  }
  return ScheduleChange.find(filter).sort({ createdAt: -1 }).limit(options.limit ?? 100);
}

export async function findChangeById(
  userId: Types.ObjectId,
  changeId: string,
): Promise<ScheduleChangeDocument> {
  return requireOwnedChange(changeId, userId);
}

/** Approves a queued change (optionally with human corrections) and audits it. */
export async function approveChange(
  userId: Types.ObjectId,
  changeId: string,
  edits: ReviewEdits = {},
): Promise<ScheduleChangeDocument> {
  const change = await requireOwnedChange(changeId, userId);
  if (change.status !== 'PENDING_REVIEW') {
    throw ApiError.conflict(`Change is ${change.status}, not pending review`);
  }

  if (edits.occurrenceDate) {
    change.occurrenceDate = edits.occurrenceDate;
  }
  if (edits.startTime !== undefined || edits.endTime !== undefined || edits.room !== undefined) {
    change.newValue = {
      ...(change.newValue ?? {}),
      ...(edits.startTime !== undefined ? { startTime: edits.startTime } : {}),
      ...(edits.endTime !== undefined ? { endTime: edits.endTime } : {}),
      ...(edits.room !== undefined ? { room: edits.room ?? undefined } : {}),
    };
  }

  change.status = 'APPLIED_MANUALLY';
  change.appliedBy = 'USER';
  await change.save();

  await appendAuditLog({
    userId,
    actor: 'USER',
    action: 'CHANGE_APPLIED',
    changeId: change._id,
    targetEntryId: change.targetEntryId,
    occurrenceDate: change.occurrenceDate,
    afterSnapshot: snapshotFrom(change.newValue),
    reason: 'approved from the review queue',
  });

  const payload: ScheduleChangePayload = {
    changeId: change.id,
    entryId: String(change.targetEntryId),
    occurrenceDate: change.occurrenceDate,
    courseCode: null,
    action: change.action,
    confidence: change.confidence,
    status: change.status,
    reason: null,
  };
  publishReviewResolved(String(userId), payload);
  if (change.action === 'CANCEL') {
    publishScheduleCancelled(String(userId), payload);
  } else {
    publishScheduleUpdated(String(userId), payload);
  }

  return change;
}

/** Rejects a queued change; it stays in the audit trail as REJECTED. */
export async function rejectChange(
  userId: Types.ObjectId,
  changeId: string,
  reason?: string,
): Promise<ScheduleChangeDocument> {
  const change = await requireOwnedChange(changeId, userId);
  if (change.status !== 'PENDING_REVIEW') {
    throw ApiError.conflict(`Change is ${change.status}, not pending review`);
  }

  change.status = 'REJECTED';
  change.appliedBy = 'USER';
  await change.save();

  await appendAuditLog({
    userId,
    actor: 'USER',
    action: 'CHANGE_REJECTED',
    changeId: change._id,
    targetEntryId: change.targetEntryId,
    occurrenceDate: change.occurrenceDate,
    reason: reason ?? 'rejected from the review queue',
  });

  publishReviewResolved(String(userId), {
    changeId: change.id,
    entryId: String(change.targetEntryId),
    occurrenceDate: change.occurrenceDate,
    courseCode: null,
    action: change.action,
    confidence: change.confidence,
    status: change.status,
    reason: reason ?? null,
  });

  return change;
}

/**
 * Reverts an applied change. The effective schedule falls back to the baseline
 * automatically (the change stops being applied); nothing is deleted and the
 * audit log keeps both the application and the revert.
 */
export async function revertChange(
  userId: Types.ObjectId,
  changeId: string,
  reason?: string,
): Promise<ScheduleChangeDocument> {
  const change = await requireOwnedChange(changeId, userId);

  if (change.status === 'REVERTED') {
    throw ApiError.conflict('Change is already reverted');
  }
  if (change.status !== 'AUTO_APPLIED' && change.status !== 'APPLIED_MANUALLY') {
    throw ApiError.conflict(`Cannot revert a change with status ${change.status}`);
  }

  const audit = await appendAuditLog({
    userId,
    actor: 'USER',
    action: 'CHANGE_REVERTED',
    changeId: change._id,
    targetEntryId: change.targetEntryId,
    occurrenceDate: change.occurrenceDate,
    beforeSnapshot: snapshotFrom(change.newValue),
    afterSnapshot: snapshotFrom(change.oldValue),
    reason: reason ?? 'reverted by the user',
  });

  change.status = 'REVERTED';
  change.revertedByAuditId = audit._id;
  await change.save();

  publishChangeReverted(String(userId), {
    changeId: change.id,
    entryId: String(change.targetEntryId),
    occurrenceDate: change.occurrenceDate,
    courseCode: null,
    action: change.action,
    confidence: change.confidence,
    status: change.status,
    reason: reason ?? null,
  });
  publishScheduleUpdated(String(userId), {
    changeId: change.id,
    entryId: String(change.targetEntryId),
    occurrenceDate: change.occurrenceDate,
    courseCode: null,
    action: change.action,
    confidence: change.confidence,
    status: change.status,
    reason: reason ?? null,
  });

  return change;
}