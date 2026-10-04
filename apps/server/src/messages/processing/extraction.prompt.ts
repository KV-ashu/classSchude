import type { CourseHint } from './course-matching';

export const EXTRACTION_PROMPT_VERSION = 'extract-v1';

export const EXTRACTION_SYSTEM_INSTRUCTION = [
  'You extract college timetable changes from a single chat message.',
  'Reply with JSON only, shaped as:',
  '{ "changes": [ { "action": "CANCEL" | "RESCHEDULE_TIME" | "CHANGE_ROOM" | "MARK_ONLINE",',
  '  "courseText": string | null, "dateExpression": string | null, "timeExpression": string | null,',
  '  "room": string | null, "isAmbiguous": boolean, "certainty": number, "reason": string | null } ] }',
  'Rules:',
  '- one entry per timetable change; use an empty array when the message has none',
  '- courseText: copy the course as written (typos included); null when no course is identifiable',
  '- dateExpression: copy the date words as written ("today", "kal", "tomorrow", "Monday"); never compute a date',
  '- timeExpression: copy the time words as written ("2 PM", "11:00-12:00", "11 instead of 9"); null when absent',
  '- room: copy the room as written; null when absent',
  '- isAmbiguous: true for hedged wording ("I think", "maybe", "probably") or self-contradicting statements',
  '- certainty: your own confidence from 0 to 1; low when the message is unclear',
  '- never invent a subject, date, time or room that is not in the message',
  '- an announced ADDITIONAL class ("extra class", "makeup class", "special lecture") is a timetable',
  '  change too: extract it with the stated course, date and time even when that date has no',
  '  regular class yet, and set certainty to at most 0.6 because nothing can be cancelled',
  '- Hinglish is expected: understand "kal" (tomorrow), "aaj" (today), "cancel hai", "band", "shift"',
  '- ignore greetings, jokes and unrelated chatter',
].join('\n');

export interface ExtractionPromptContext {
  rawText: string;
  /** Message timestamp rendered in the user timezone (never the server clock). */
  messageLocalTime: string;
  timezone: string;
  courses: CourseHint[];
}

/** Builds the extraction prompt; the course list lets the model align typos. */
export function buildExtractionPrompt(context: ExtractionPromptContext): string {
  const courseList = context.courses
    .map((course) => {
      const aliases = course.aliases.length > 0 ? ` (aka: ${course.aliases.join(', ')})` : '';
      return `- ${course.code}: ${course.name}${aliases}`;
    })
    .join('\n');

  return [
    `Student timezone: ${context.timezone}`,
    `Message sent at: ${context.messageLocalTime}`,
    '',
    'Known courses:',
    courseList.length > 0 ? courseList : '- (no courses configured yet)',
    '',
    'Message:',
    context.rawText,
    '',
    'Extract the timetable changes stated in that message.',
  ].join('\n');
}

/** Prompt for the single repair attempt after a schema violation. */
export function buildRepairPrompt(previousOutput: string, issues: unknown): string {
  return [
    'Your previous answer did not match the required JSON schema.',
    `Validation issues: ${JSON.stringify(issues)}`,
    `Previous answer: ${previousOutput}`,
    'Return a corrected JSON object that follows the schema exactly. Use null for anything the message does not state.',
  ].join('\n');
}