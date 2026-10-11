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
  /** Baseline start time of a rescheduled class (so the UI can show old -> new). */
  previousStartTime: string | null;
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

  // ADD changes carry no targetEntryId - they are brand-new slots to append.
  const addedChanges = changes.filter((change) => change.action === 'ADD' && !change.targetEntryId);

  const courseIds = new Set(baseline.map((entry) => String(entry.courseId)));
  for (const change of addedChanges) {
    if (change.courseId) {
      courseIds.add(String(change.courseId));
    }
  }
  const courses = await Course.find({ _id: { $in: [...courseIds] } });
  const coursesById = new Map(courses.map((course) => [String(course._id), course]));

  const entries: EffectiveEntry[] = baseline.map((entry) => {
    const course = coursesById.get(String(entry.courseId));
    const change = changes.find(
      (candidate) =>
        candidate.targetEntryId !== undefined &&
        String(candidate.targetEntryId) === String(entry._id),
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
      previousStartTime:
        change?.action === 'RESCHEDULE_TIME' ? (change.oldValue?.startTime ?? null) : null,
    };
  });

  // Extra classes are appended as brand-new slots on the day they were added.
  const addedEntries: EffectiveEntry[] = addedChanges.map((change) => {
    const course = change.courseId ? coursesById.get(String(change.courseId)) : undefined;
    const applied = change.newValue ?? {};

    return {
      entryId: change.id,
      courseId: change.courseId ? String(change.courseId) : '',
      courseCode: course?.code ?? null,
      courseName: course?.name ?? null,
      day: weekday,
      startTime: applied.startTime ?? '00:00',
      endTime: applied.endTime ?? '00:00',
      room: applied.room ?? null,
      kind: applied.kind ?? 'LECTURE',
      status: 'SCHEDULED' as EffectiveStatus,
      changeId: change.id,
      changed: true,
      previousStartTime: null,
    };
  });

  return { occurrenceDate, version, entries: [...entries, ...addedEntries] };
}
