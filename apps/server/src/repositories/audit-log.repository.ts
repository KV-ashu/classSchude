import type { AuditActor } from '@classsync/shared';
import type { Types } from 'mongoose';
import { AuditLog, type AuditEntrySnapshot, type AuditLogDocument } from '../models/index';

export interface AppendAuditLogInput {
  userId: Types.ObjectId;
  actor: AuditActor;
  action: string;
  changeId?: Types.ObjectId;
  targetEntryId?: Types.ObjectId;
  occurrenceDate?: string;
  beforeSnapshot?: AuditEntrySnapshot;
  afterSnapshot?: AuditEntrySnapshot;
  reason?: string;
}

/** Appends one immutable audit entry (the only write this collection allows). */
export async function appendAuditLog(input: AppendAuditLogInput): Promise<AuditLogDocument> {
  return AuditLog.create(input);
}

export async function listAuditLogByUser(
  userId: Types.ObjectId,
  limit = 100,
): Promise<AuditLogDocument[]> {
  return AuditLog.find({ userId }).sort({ createdAt: -1 }).limit(limit);
}

export async function listAuditLogByChange(changeId: Types.ObjectId): Promise<AuditLogDocument[]> {
  return AuditLog.find({ changeId }).sort({ createdAt: 1 });
}
