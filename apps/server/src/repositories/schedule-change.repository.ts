import type { ChangeStatus, ScheduleChangeAction } from '@classsync/shared';
import type { Types } from 'mongoose';
import {
  ScheduleChange,
  type ChangeValueSnapshot,
  type ConfidenceFactors,
  type ScheduleChangeDoc,
  type ScheduleChangeDocument,
} from '../models/index';

export interface CreateScheduleChangeInput {
  userId: Types.ObjectId;
  rawMessageId: Types.ObjectId;
  targetEntryId: Types.ObjectId;
  occurrenceDate: string;
  action: ScheduleChangeAction;
  oldValue?: ChangeValueSnapshot;
  newValue?: ChangeValueSnapshot;
  confidence: number;
  confidenceFactors?: ConfidenceFactors;
  status?: ChangeStatus;
  appliedBy?: ScheduleChangeDoc['appliedBy'];
}

export async function createScheduleChange(
  input: CreateScheduleChangeInput,
): Promise<ScheduleChangeDocument> {
  return ScheduleChange.create(input);
}

export async function findScheduleChangeById(
  changeId: string,
): Promise<ScheduleChangeDocument | null> {
  return ScheduleChange.findById(changeId);
}

export async function listChangesByUser(
  userId: Types.ObjectId,
  limit = 100,
): Promise<ScheduleChangeDocument[]> {
  return ScheduleChange.find({ userId }).sort({ createdAt: -1 }).limit(limit);
}

export async function listPendingReview(userId: Types.ObjectId): Promise<ScheduleChangeDocument[]> {
  return ScheduleChange.find({ userId, status: 'PENDING_REVIEW' }).sort({ createdAt: 1 });
}

export async function updateChangeStatus(
  changeId: string,
  status: ChangeStatus,
): Promise<ScheduleChangeDocument | null> {
  return ScheduleChange.findByIdAndUpdate(changeId, { $set: { status } }, { returnDocument: 'after' });
}
