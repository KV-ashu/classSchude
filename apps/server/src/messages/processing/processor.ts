import type { PipelineStatus, ScheduleChangeAction } from '@classsync/shared';
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
  addMinutes,
  isoWeekdayOf,
  minutesBetween,
  resolveOccurrenceDate,
  resolveTimeExpression,
} from './resolution';
import { findConflict, findTargetEntry } from './validation';

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
  const occurrenceDate = resolveOccurrenceDate(draft.dateExpression, {
    messageTimestamp: message.timestamp,
    timezone,
  });
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

  // 3. Time resolution (only RESCHEDULE_TIME consumes it).
  const time = resolveTimeExpression(draft.timeExpression);
  const missingRequiredField =
    (draft.action === 'CHANGE_ROOM' && !draft.room) ||
    (draft.action === 'RESCHEDULE_TIME' && !time?.startTime);

  // 4. Target baseline entry for that course and weekday.
  const target = findTargetEntry(
    entries,
    courseMatch.hint.id,
    occurrenceDate,
    time?.mentioned ?? [],
  );
  const entry = target.entry;
  if (!entry) {
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
      note: target.reason ?? 'no matching baseline class',
    };
  }

  // 5. Proposed state (baseline + this change).
  let startTime = entry.startTime;
  let endTime = entry.endTime;
  let room = entry.room;

  if (draft.action === 'RESCHEDULE_TIME' && time?.startTime) {
    startTime = time.startTime;
    endTime = time.endTime ?? addMinutes(startTime, minutesBetween(entry.startTime, entry.endTime));
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

  // 6. Conflict detection against the rest of that weekday.
  const weekday = isoWeekdayOf(occurrenceDate);
  const dayEntries =
    weekday === null ? [] : entries.filter((candidate) => candidate.dayOfWeek === weekday);
  const conflictingEntry = findConflict(dayEntries, {
    entryId: String(entry._id),
    startTime,
    endTime,
  });
  const hasConflict = conflictingEntry !== null;

  // 7. Deterministic confidence + policy routing.
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
    targetEntryId: entry._id,
    occurrenceDate,
    action: draft.action,
    oldValue: {
      startTime: entry.startTime,
      endTime: entry.endTime,
      room: entry.room,
      kind: entry.kind,
    },
    newValue: { startTime, endTime, room, kind: entry.kind },
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
      targetEntryId: entry._id,
      occurrenceDate,
      beforeSnapshot: {
        entryId: String(entry._id),
        courseId: String(entry.courseId),
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.room ?? null,
        kind: entry.kind,
      },
      afterSnapshot: {
        entryId: String(entry._id),
        courseId: String(entry.courseId),
        dayOfWeek: entry.dayOfWeek,
        startTime,
        endTime,
        room: room ?? null,
        kind: entry.kind,
      },
      reason: draft.reason ?? 'auto-applied',
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

  const status = decideMessageStatus(changes);
  await updateRawMessageStatus(messageId, status, []);
  await setRawMessageLlmMeta(messageId, {
    provider: provider.name,
    model: extraction.model,
    latencyMs: extraction.latencyMs,
    promptVersion: extraction.promptVersion,
    repairAttempted: extraction.repaired,
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

/** Fire-and-forget wrapper: one broken message can never take the worker down. */
export async function processRawMessageSafely(
  messageId: string,
  options: ProcessOptions = {},
): Promise<void> {
  try {
    await processRawMessage(messageId, options);
  } catch (error) {
    console.error(`[pipeline] processing failed for message ${messageId}:`, error);
  }
}