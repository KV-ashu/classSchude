import type { TimetableEntryDocument } from '../../models/index';
import { isoWeekdayOf } from './resolution';

export interface TargetResolution {
  entry: TimetableEntryDocument | null;
  /** Why no target could be resolved (null when resolved). */
  reason: string | null;
  /** The message referenced the entry's current start time ("... instead of 11:00"). */
  mentionsCurrentStart: boolean;
}

/**
 * Finds the single baseline entry a change applies to: the course must exist in
 * the baseline and have exactly one class on the resolved weekday.
 */
export function findTargetEntry(
  entries: TimetableEntryDocument[],
  courseId: string,
  occurrenceDate: string,
  mentionedTimes: string[] = [],
): TargetResolution {
  const weekday = isoWeekdayOf(occurrenceDate);
  if (weekday === null) {
    return {
      entry: null,
      reason: `occurrence date '${occurrenceDate}' is not a calendar date`,
      mentionsCurrentStart: false,
    };
  }

  const candidates = entries.filter(
    (entry) => String(entry.courseId) === courseId && entry.dayOfWeek === weekday,
  );

  if (candidates.length === 0) {
    return {
      entry: null,
      reason: 'no baseline class for that course on that weekday',
      mentionsCurrentStart: false,
    };
  }

  if (candidates.length > 1) {
    return {
      entry: null,
      reason: 'multiple baseline classes for that course on that weekday',
      mentionsCurrentStart: false,
    };
  }

  const entry = candidates[0];
  if (!entry) {
    return { entry: null, reason: 'baseline entry vanished', mentionsCurrentStart: false };
  }

  // In "11 instead of 9" the second time refers to the current start.
  const mentionsCurrentStart = mentionedTimes.slice(1).includes(entry.startTime);

  return { entry, reason: null, mentionsCurrentStart };
}

export interface ProposedWindow {
  entryId: string;
  startTime: string;
  endTime: string;
}

/** Returns the entry the proposed window would overlap, if any. */
export function findConflict(
  dayEntries: TimetableEntryDocument[],
  proposal: ProposedWindow,
): TimetableEntryDocument | null {
  const conflict = dayEntries.find(
    (entry) =>
      String(entry._id) !== proposal.entryId &&
      entry.startTime < proposal.endTime &&
      proposal.startTime < entry.endTime,
  );

  return conflict ?? null;
}