import type { Types } from 'mongoose';
import {
  TimetableEntry,
  type TimetableEntryDoc,
  type TimetableEntryDocument,
} from '../models/index';

export interface CreateTimetableEntryInput {
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
  kind?: TimetableEntryDoc['kind'];
  baselineVersion?: number;
}

export async function createTimetableEntry(
  input: CreateTimetableEntryInput,
): Promise<TimetableEntryDocument> {
  return TimetableEntry.create(input);
}

export async function createManyTimetableEntries(
  inputs: CreateTimetableEntryInput[],
): Promise<TimetableEntryDocument[]> {
  const created = await TimetableEntry.insertMany(inputs);
  // Schema defaults (kind, baselineVersion, locked) are not part of the input
  // type, so insertMany infers a wider shape than the hydrated documents.
  return created as TimetableEntryDocument[];
}

export async function listEntriesByUser(
  userId: Types.ObjectId,
  options: { baselineVersion?: number } = {},
): Promise<TimetableEntryDocument[]> {
  if (options.baselineVersion !== undefined) {
    return TimetableEntry.find({ userId, baselineVersion: options.baselineVersion }).sort({
      dayOfWeek: 1,
      startTime: 1,
    });
  }
  return TimetableEntry.find({ userId }).sort({ dayOfWeek: 1, startTime: 1 });
}

export async function findLatestBaselineVersion(userId: Types.ObjectId): Promise<number> {
  const latest = await TimetableEntry.findOne({ userId })
    .sort({ baselineVersion: -1 })
    .select('baselineVersion')
    .lean<{ baselineVersion: number } | null>();
  return latest?.baselineVersion ?? 0;
}

/** Confirms the given baseline version - see TimetableEntryModel.lockBaseline. */
export async function lockBaseline(userId: Types.ObjectId, baselineVersion: number): Promise<number> {
  return TimetableEntry.lockBaseline(userId, baselineVersion);
}
