import { logger } from '../../config/logger';
import type {
  PipelineStatus,
  ScheduleChangeAction,
  ScheduleChangePayload,
  TimetableEntryKind,
} from '@classsync/shared';
import { ApiError } from '../../errors';
import { createLlmProvider } from '../../llm/factory';
import type { LlmProvider } from '../../llm/types';
import {
  RawMessage,
  ScheduleChange,
  type CourseDocument,
  type RawMessageDocument,
  type TimetableEntryDocument,
} from '../../models/index';
import { appendAuditLog } from '../../repositories/audit-log.repository';
import { listCoursesByUser } from '../../repositories/course.repository';
import {
  setRawMessageLlmMeta,
  updateRawMessageStatus,
} from '../../repositories/raw-message.repository';
import {
  findLatestBaselineVersion,
  listEntriesByUser,
} from '../../repositories/timetable-entry.repository';
import { findUserById } from '../../repositories/user.repository';
import { decide, scoreConfidence, type Decision } from './confidence';
import { matchCourse, type CourseHint } from './course-matching';
import { extractScheduleChanges } from './extraction';
import { evaluateRelevance } from './relevance';
import type { ExtractedChange } from './extraction.schemas';
import {
  publishMessageProcessed,
  publishReviewRequired,
  publishScheduleCancelled,
  publishScheduleUpdated,
} from '../../realtime/socket';
import {
  addMinutes,
  isoWeekdayOf,
  messageLocalDate,
  minutesBetween,
  resolveOccurrenceDate,
  resolveTimeExpression,
} from './resolution';
import { findConflict, findTargetEntry } from './validation';

/** Room assumed for an extra class when the message names none. */
const DEFAULT_EXTRA_CLASS_ROOM = 'Usual Room';
/** Duration (minutes) assumed for an extra class when the message gives only a start time. */
const EXTRA_CLASS_DEFAULT_DURATION_MIN = 60;

export interface ChangeOutcome {
  changeId: string | null;
  action: ScheduleChangeAction;
  decision: Decision;
  confidence: number;
  courseCode: string | null;
  occurrenceDate: string | null;
  note: string;
}

export interface ProcessResult {
  messageId: string;
  status: PipelineStatus;
  relevance: string;
  changes: ChangeOutcome[];
  promptVersion?: string;
  model?: string;
  /** True when the model's first answer had to be repaired. */
  repaired?: boolean;
}

export interface ProcessOptions {
  /** Injected provider (tests); defaults to the configured provider. */
  provider?: LlmProvider;
}

export function toCourseHint(course: CourseDocument): CourseHint {
  return { id: course.id, code: course.code, name: course.name, aliases: course.aliases };
}

interface DraftContext {
  draft: ExtractedChange;
  message: RawMessageDocument;
  entries: TimetableEntryDocument[];
  courses: CourseHint[];
  timezone: string;
}

/** Validates, scores and persists a single extracted change. */
async function processDraft(context: DraftContext): Promise<ChangeOutcome> {
  const { draft, message, entries, courses, timezone } = context;

  // 1. The subject must exist in the baseline (code, name, alias or close typo).
  const courseMatch = matchCourse(draft.courseText ?? message.rawText, courses);
  if (!courseMatch) {
    return {
      changeId: null,
      action: draft.action,
      decision: 'REJECT',
      confidence: 0,
      courseCode: null,
      occurrenceDate: null,
      note: 'no course in the baseline matches the message',
    };
  }
  const courseCode = courseMatch.hint.code;

  // 2. Date resolution - anchored on the MESSAGE timestamp in the user timezone.
  const isAdd = draft.action === 'ADD';
  const resolvedDate = resolveOccurrenceDate(draft.dateExpression, {
    messageTimestamp: message.timestamp,
    timezone,
  });
  // An announced extra class with no date is assumed to land on the message's own day.
  const occurrenceDate =
    resolvedDate ??
    (isAdd ? messageLocalDate({ messageTimestamp: message.timestamp, timezone }) : null);
  if (!occurrenceDate) {
    const { score } = scoreConfidence({
      certainty: draft.certainty,
      courseMatchScore: courseMatch.score,
      courseMatchEdits: courseMatch.edits,
      // The course is resolved; only the date is missing, so a human can finish it.
      targetResolved: true,
      isAmbiguous: draft.isAmbiguous,
      hasConflict: false,
      missingOccurrenceDate: true,
      missingRequiredField: false,
    });
    return {
      changeId: null,
      action: draft.action,
      decision: decide(score),
      confidence: score,
      courseCode,
      occurrenceDate: null,
      note: 'message states no date - a human must choose the date',
    };
  }

  // 3. Time resolution (RESCHEDULE_TIME and ADD consume it).
  const time = resolveTimeExpression(draft.timeExpression);
  const missingRequiredField =
    (draft.action === 'CHANGE_ROOM' && !draft.room) ||
    ((draft.action === 'RESCHEDULE_TIME' || isAdd) && !time?.startTime);

  // 4. Target baseline entry for that course and weekday. An ADD creates a brand-new
  //    slot (an extra/makeup class, often on a weekend), so it never needs an existing entry.
  const target = isAdd
    ? null
    : findTargetEntry(entries, courseMatch.hint.id, occurrenceDate, time?.mentioned ?? []);
  const entry = target?.entry ?? null;
  if (!isAdd && !entry) {
    const { score } = scoreConfidence({
      certainty: draft.certainty,
      courseMatchScore: courseMatch.score,
      courseMatchEdits: courseMatch.edits,
      targetResolved: false,
      isAmbiguous: draft.isAmbiguous,
      hasConflict: false,
      missingOccurrenceDate: false,
      missingRequiredField,
    });
    return {
      changeId: null,
      action: draft.action,
      decision: decide(score),
      confidence: score,
      courseCode,
      occurrenceDate,
      note: target?.reason ?? 'no matching baseline class',
    };
  }

  // 5. Proposed state (baseline + this change, or a brand-new extra-class slot).
  let startTime: string;
  let endTime: string;
  let room: string | undefined;
  let kind: TimetableEntryKind;

  if (entry) {
    startTime = entry.startTime;
    endTime = entry.endTime;
    room = entry.room;
    kind = entry.kind;

    if (draft.action === 'RESCHEDULE_TIME' && time?.startTime) {
      startTime = time.startTime;
      endTime =
        time.endTime ?? addMinutes(startTime, minutesBetween(entry.startTime, entry.endTime));
      if (endTime <= startTime) {
        return {
          changeId: null,
          action: draft.action,
          decision: 'REJECT',
          confidence: 0,
          courseCode,
          occurrenceDate,
          note: `invalid time range ${startTime}-${endTime}`,
        };
      }
    }
    if (draft.action === 'CHANGE_ROOM' && draft.room) {
      room = draft.room;
    }
  } else {
    // Extra class: there is no baseline slot to inherit from, so fill the gaps
    // with the documented defaults instead of rejecting the change outright.
    if (!time?.startTime) {
      return {
        changeId: null,
        action: draft.action,
        decision: 'REJECT',
        confidence: 0,
        courseCode,
        occurrenceDate,
        note: 'extra class states no start time',
      };
    }
    startTime = time.startTime;
    endTime = time.endTime ?? addMinutes(startTime, EXTRA_CLASS_DEFAULT_DURATION_MIN);
    if (endTime <= startTime) {
      return {
        changeId: null,
        action: draft.action,
        decision: 'REJECT',
        confidence: 0,
        courseCode,
        occurrenceDate,
        note: `invalid time range ${startTime}-${endTime}`,
      };
    }
    room = draft.room?.trim() ? draft.room : DEFAULT_EXTRA_CLASS_ROOM;
    kind = 'LECTURE';
  }

  // 6. Conflict detection against the rest of that weekday.
  const weekday = isoWeekdayOf(occurrenceDate);
  const dayEntries =
    weekday === null ? [] : entries.filter((candidate) => candidate.dayOfWeek === weekday);
  const conflictingEntry = findConflict(dayEntries, {
    entryId: entry ? String(entry._id) : '',
    startTime,
    endTime,
  });
  const hasConflict = conflictingEntry !== null;

  // 7. Deterministic confidence + policy routing. An ADD never needs an existing
  //    target slot, so it always counts as resolved.
  const { score, factors } = scoreConfidence({
    certainty: draft.certainty,
    courseMatchScore: courseMatch.score,
    courseMatchEdits: courseMatch.edits,
    targetResolved: true,
    isAmbiguous: draft.isAmbiguous,
    hasConflict,
    missingOccurrenceDate: false,
    missingRequiredField,
  });
  const decision = decide(score);

  // 8. Persist the change (rejected ones stay for the audit trail).
  const change = await ScheduleChange.create({
    userId: message.userId,
    rawMessageId: message._id,
    // An ADD has no baseline entry yet - the change itself defines the new slot.
    targetEntryId: entry?._id,
    courseId: courseMatch.hint.id,
    occurrenceDate,
    action: draft.action,
    oldValue: entry
      ? {
          startTime: entry.startTime,
          endTime: entry.endTime,
          room: entry.room,
          kind: entry.kind,
        }
      : undefined,
    newValue: { startTime, endTime, room, kind },
    confidence: score,
    confidenceFactors: {
      certainty: factors.certainty,
      aliasMatch: factors.courseMatch,
      ambiguityPenalty: factors.ambiguityPenalty,
      conflictPenalty: factors.conflictPenalty,
    },
    status:
      decision === 'AUTO_APPLY'
        ? 'AUTO_APPLIED'
        : decision === 'REVIEW'
          ? 'PENDING_REVIEW'
          : 'REJECTED',
    appliedBy: 'AI',
  });

  // 9. Auto-applied changes are written to the immutable audit log.
  if (decision === 'AUTO_APPLY') {
    await appendAuditLog({
      userId: message.userId,
      actor: 'AI',
      action: 'CHANGE_APPLIED',
      changeId: change._id,
      targetEntryId: entry?._id,
      occurrenceDate,
      beforeSnapshot: entry
        ? {
            entryId: String(entry._id),
            courseId: String(entry.courseId),
            dayOfWeek: entry.dayOfWeek,
            startTime: entry.startTime,
            endTime: entry.endTime,
            room: entry.room ?? null,
            kind: entry.kind,
          }
        : undefined,
      afterSnapshot: {
        // An ADD has no entry id yet - the change id stands in for the new slot.
        entryId: entry ? String(entry._id) : change.id,
        courseId: courseMatch.hint.id,
        dayOfWeek: entry?.dayOfWeek ?? weekday ?? undefined,
        startTime,
        endTime,
        room: room ?? null,
        kind,
      },
      reason: draft.reason ?? 'auto-applied',
    });

    // Real-time: tell the UI the effective schedule just changed.
    const payload: ScheduleChangePayload = {
      changeId: change.id,
      entryId: entry ? String(entry._id) : change.id,
      occurrenceDate,
      courseCode,
      action: draft.action,
      confidence: score,
      status: 'AUTO_APPLIED',
      reason: draft.reason ?? null,
    };
    if (draft.action === 'CANCEL') {
      publishScheduleCancelled(String(message.userId), payload);
    } else {
      publishScheduleUpdated(String(message.userId), payload);
    }
  }

  if (decision === 'REVIEW') {
    publishReviewRequired(String(message.userId), {
      changeId: change.id,
      entryId: entry ? String(entry._id) : change.id,
      occurrenceDate,
      courseCode,
      action: draft.action,
      confidence: score,
      status: 'PENDING_REVIEW',
      reason: draft.reason ?? null,
    });
  }

  return {
    changeId: change.id,
    action: draft.action,
    decision,
    confidence: score,
    courseCode,
    occurrenceDate,
    note: decisionNote(decision, hasConflict),
  };
}

function decisionNote(decision: Decision, hasConflict: boolean): string {
  if (decision === 'AUTO_APPLY') {
    return 'applied automatically';
  }
  if (decision === 'REVIEW') {
    return hasConflict ? 'queued for review: overlaps another class' : 'queued for review';
  }
  return 'rejected by the confidence policy';
}

/**
 * Runs the full pipeline for one stored message:
 * relevance -> extraction -> resolution -> validation/conflict -> scoring -> routing.
 * Every failure mode is recorded on the RawMessage; it never throws raw
 * provider/database errors at the caller.
 */
export async function processRawMessage(
  messageId: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const message = await RawMessage.findById(messageId);
  if (!message) {
    throw ApiError.notFound('Raw message not found');
  }

  await updateRawMessageStatus(messageId, 'PROCESSING');

  const user = await findUserById(String(message.userId));
  if (!user) {
    await updateRawMessageStatus(messageId, 'FAILED', ['Owning account no longer exists']);
    throw ApiError.notFound('Owning account no longer exists');
  }

  const courses = await listCoursesByUser(message.userId);
  const hints = courses.map(toCourseHint);

  // 1. Local relevance gate - chatter never reaches the LLM.
  const relevance = evaluateRelevance(message.rawText, hints);
  if (!relevance.relevant) {
    await updateRawMessageStatus(messageId, 'IGNORED');
    return { messageId, status: 'IGNORED', relevance: relevance.reason, changes: [] };
  }

  const latestVersion = await findLatestBaselineVersion(message.userId);
  if (latestVersion === 0) {
    await updateRawMessageStatus(messageId, 'REJECTED', ['No baseline timetable configured']);
    return { messageId, status: 'REJECTED', relevance: relevance.reason, changes: [] };
  }

  const entries = await listEntriesByUser(message.userId, { baselineVersion: latestVersion });

  // 2. LLM extraction (one call plus at most one repair pass).
  const provider = options.provider ?? createLlmProvider();
  let extraction;
  try {
    extraction = await extractScheduleChanges(provider, {
      rawText: message.rawText,
      timestamp: message.timestamp,
      timezone: user.timezone,
      courses: hints,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'LLM extraction failed';
    await updateRawMessageStatus(messageId, 'FAILED', [reason]);
    throw error instanceof Error ? error : new Error(reason);
  }

  // 3. Per-change validation, scoring and routing.
  const changes: ChangeOutcome[] = [];
  for (const draft of extraction.result.changes) {
    changes.push(
      await processDraft({ draft, message, entries, courses: hints, timezone: user.timezone }),
    );
  }

  // Every non-applied outcome is surfaced on the message so the UI and the logs
  // can explain WHY something was rejected or queued for review.
  const processingErrors = changes
    .filter((outcome) => outcome.decision !== 'AUTO_APPLY')
    .map(
      (outcome) =>
        `${outcome.action} for ${outcome.courseCode ?? 'unknown course'} on ${
          outcome.occurrenceDate ?? '(no date)'
        }: ${outcome.note} (confidence ${outcome.confidence})`,
    );
  for (const processingError of processingErrors) {
    logger.warn({ messageId, processingError }, 'schedule change not auto-applied');
  }

  const status = decideMessageStatus(changes);
  await updateRawMessageStatus(messageId, status, processingErrors);
  await setRawMessageLlmMeta(messageId, {
    provider: provider.name,
    model: extraction.model,
    latencyMs: extraction.latencyMs,
    promptVersion: extraction.promptVersion,
    repairAttempted: extraction.repaired,
  });

  // Real-time: the messages view refreshes itself when processing finishes.
  publishMessageProcessed(String(message.userId), {
    messageId,
    status,
    changes: changes.map((change) => ({
      action: change.action,
      decision: change.decision,
      courseCode: change.courseCode,
    })),
  });

  return {
    messageId,
    status,
    relevance: relevance.reason,
    changes,
    promptVersion: extraction.promptVersion,
    model: extraction.model,
    repaired: extraction.repaired,
  };
}

function decideMessageStatus(changes: ChangeOutcome[]): PipelineStatus {
  if (changes.length === 0) {
    return 'REJECTED';
  }
  if (changes.some((change) => change.decision === 'AUTO_APPLY')) {
    return 'APPLIED';
  }
  if (changes.some((change) => change.decision === 'REVIEW')) {
    return 'QUEUED';
  }
  return 'REJECTED';
}

export async function failStrandedMessage(messageId: string, reason: string): Promise<boolean> {
  const stranded = await RawMessage.findById(messageId).select('userId status').lean();
  if (!stranded || (stranded.status !== 'RECEIVED' && stranded.status !== 'PROCESSING')) {
    return false;
  }
  await updateRawMessageStatus(messageId, 'FAILED', [reason]);
  publishMessageProcessed(String(stranded.userId), { messageId, status: 'FAILED', changes: [] });
  return true;
}

/** Fire-and-forget wrapper: one broken message can never take the worker down. */
export async function processRawMessageSafely(
  messageId: string,
  options: ProcessOptions = {},
): Promise<void> {
  try {
    await processRawMessage(messageId, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error({ error, messageId, reason }, 'message processing failed');
    await failStrandedMessage(messageId, reason);
  }
}
