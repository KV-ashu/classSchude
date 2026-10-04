import type { ChangeStatus } from '@classsync/shared';
import type { Types } from 'mongoose';
import { Course, ScheduleChange } from '../models/index';
import { isoWeekdayOf } from '../messages/processing/resolution';
import {
  findLatestBaselineVersion,
  listEntriesByUser,
} from '../repositories/timetable-entry.repository';

export type EffectiveStatus = 'SCHEDULED' | 'CANCELLED' | 'ONLINE';

export interface EffectiveEntry {
  entryId: string;
  courseId: string;
  courseCode: string | null;
  courseName: string | null;
  day: number;
  startTime: string;
  endTime: string;
  room: string | null;
  kind: string;
  status: EffectiveStatus;
  /** The change that produced this state, if any. */
  changeId: string | null;
  /** False while the entry still matches the immutable baseline. */
  changed: boolean;
}

export interface EffectiveDay {
  occurrenceDate: string;
  version: number;
  entries: EffectiveEntry[];
}

const APPLIED_STATUSES: ChangeStatus[] = ['AUTO_APPLIED', 'APPLIED_MANUALLY'];

/**
 * The EFFECTIVE timetable: immutable baseline + applied ScheduleChanges.
 * The baseline is never touched; a reverted change simply stops being applied,
 * which restores the baseline state without deleting history.
 */
export async function getEffectiveDay(
  userId: Types.ObjectId,
  occurrenceDate: string,
): Promise<EffectiveDay> {
  const version = await findLatestBaselineVersion(userId);
  const weekday = isoWeekdayOf(occurrenceDate);

  if (version === 0 || weekday === null) {
    return { occurrenceDate, version, entries: [] };
  }

  const baseline = (await listEntriesByUser(userId, { baselineVersion: version })).filter(
    (entry) => entry.dayOfWeek === weekday,
  );

  const changes = await ScheduleChange.find({
    userId,
    occurrenceDate,
    status: { $in: APPLIED_STATUSES },
  });

  const courseIds = [...new Set(baseline.map((entry) => String(entry.courseId)))];
  const courses = await Course.find({ _id: { $in: courseIds } });
  const coursesById = new Map(courses.map((course) => [String(course._id), course]));

  const entries: EffectiveEntry[] = baseline.map((entry) => {
    const course = coursesById.get(String(entry.courseId));
    const change = changes.find(
      (candidate) => String(candidate.targetEntryId) === String(entry._id),
    );
    const applied = change?.newValue ?? {};

    return {
      entryId: entry.id,
      courseId: String(entry.courseId),
      courseCode: course?.code ?? null,
      courseName: course?.name ?? null,
      day: entry.dayOfWeek,
      startTime: applied.startTime ?? entry.startTime,
      endTime: applied.endTime ?? entry.endTime,
      room: applied.room ?? entry.room ?? null,
      kind: applied.kind ?? entry.kind,
      status:
        change?.action === 'CANCEL'
          ? 'CANCELLED'
          : change?.action === 'MARK_ONLINE'
            ? 'ONLINE'
            : 'SCHEDULED',
      changeId: change?.id ?? null,
      changed: change !== undefined,
    };
  });

  return { occurrenceDate, version, entries };
}