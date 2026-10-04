import { matchCourse, type CourseHint } from './course-matching';

/** Words that tie a message to the academic timetable domain. */
const SCHEDULE_CONTEXT_PATTERN =
  /\b(class|classes|lecture|lectures|lab|labs|timetable|schedule|scheduled|semester|sem)\b/i;

/**
 * Change intent patterns (English + Hinglish). Kept local and cheap: this is
 * the gate that avoids burning LLM calls on ordinary chatter.
 */
const CHANGE_INTENT_PATTERNS: { name: string; pattern: RegExp }[] = [
  // Extra / makeup classes are real schedule changes (an added class on a day
  // that may not even be in the baseline), so they must reach the LLM.
  {
    name: 'extra-class',
    pattern:
      /\b(extra|make\s?up|makeup|special|additional|double|one\s+more|extra\s+one)\s+(class|classes|lecture|lectures|session|sessions|period|periods|hour|hours)\b/i,
  },
  { name: 'cancel', pattern: /\b(cancel|cancell?ed|cancellation|cancelling)\b/i },
  { name: 'postpone', pattern: /\bpostpon(e|ed|ement)\b/i },
  { name: 'reschedule', pattern: /\breschedul(e|ed|ing)\b/i },
  { name: 'shift', pattern: /\b(shift|shifted)\b/i },
  { name: 'move', pattern: /\b(moved|move)\b/i },
  { name: 'room', pattern: /\b(room|venue|classroom|hall)\b/i },
  { name: 'online', pattern: /\b(online|offline|meet|video call)\b/i },
  { name: 'suspend', pattern: /\b(suspend(ed)?|on hold|put off)\b/i },
  // A class that starts/ends late or runs longer is still a timetable change.
  {
    name: 'extend',
    pattern:
      /\b(class|lecture|session|lab)\b[^.\n]{0,25}\b(extend(ed|s)?|prolong(ed)?|running\s+(over|long)|late\s+by|extra\s+\d+\s*(min|minute|hour))\b|\b(extend(ed|s)?|prolong(ed)?)\b[^.\n]{0,25}\b(class|lecture|session|lab|min|minute|hour)\b/i,
  },
  // Hinglish intent verbs
  { name: 'hinglish-cancel', pattern: /\b(cancel|band|ruk|skip|nahi hoga|hoga nahi)\b/i },
  { name: 'hinglish-move', pattern: /\b(shift|time change|room change|na chalegi|chal rahi)\b/i },
  { name: 'hinglish-extra', pattern: /\bextra\s*(class|lecture|session|period)\b/i },
];

export interface RelevanceResult {
  relevant: boolean;
  reason: string;
  matchedCourses: string[];
  matchedIntents: string[];
}

/**
 * Fast, non-LLM relevance check. A message is relevant when it carries a
 * schedule-change intent AND (matches a known course OR mentions timetable
 * vocabulary). Everything else is discarded before any LLM call.
 */
export function evaluateRelevance(rawText: string, courses: CourseHint[]): RelevanceResult {
  const matchedIntents = CHANGE_INTENT_PATTERNS.filter((entry) => entry.pattern.test(rawText)).map(
    (entry) => entry.name,
  );

  if (matchedIntents.length === 0) {
    return {
      relevant: false,
      reason: 'no schedule-change intent detected',
      matchedCourses: [],
      matchedIntents,
    };
  }

  const courseMatch = matchCourse(rawText, courses);
  const hasScheduleContext = SCHEDULE_CONTEXT_PATTERN.test(rawText);

  if (!courseMatch && !hasScheduleContext) {
    return {
      relevant: false,
      reason: 'intent detected but no course or timetable reference',
      matchedCourses: [],
      matchedIntents,
    };
  }

  return {
    relevant: true,
    reason: courseMatch
      ? `matched course ${courseMatch.hint.code}`
      : 'schedule vocabulary detected',
    matchedCourses: courseMatch ? [courseMatch.hint.code] : [],
    matchedIntents,
  };
}