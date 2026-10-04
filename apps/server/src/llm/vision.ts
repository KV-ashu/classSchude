/**
 * Prompt used to turn a timetable photo into structured JSON.
 * Kept in one versioned place so extraction behaviour stays auditable and can
 * be regression-tested independently of the provider.
 */
export const VISION_PROMPT_VERSION = 'vision-v1';

export const VISION_SYSTEM_INSTRUCTION = [
  'You extract a college timetable from an image.',
  'Reply with JSON only, shaped as:',
  '{ "entries": [ { "courseCode": string, "courseName": string, "day": number, "startTime": "HH:mm", "endTime": "HH:mm", "room": string, "kind": "LECTURE" | "LAB" | "TUTORIAL" } ] }',
  'Rules:',
  '- day is the ISO weekday: 1 = Monday ... 7 = Sunday',
  '- times are 24-hour HH:mm',
  '- only include classes you can actually read; never invent courses, rooms or times',
  '- omit unreadable cells instead of guessing',
  '- kind defaults to LECTURE',
].join('\n');

export function buildVisionPrompt(): string {
  return 'Extract every class you can read from this timetable image. Return the entries array.';
}