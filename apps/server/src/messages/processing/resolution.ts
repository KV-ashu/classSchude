import { DateTime } from 'luxon';

export interface ResolutionContext {
  /** Timestamp of the MessageEvent - the only clock the pipeline may use. */
  messageTimestamp: Date;
  /** IANA timezone of the owning user. */
  timezone: string;
}

const RELATIVE_DAYS: { pattern: RegExp; days: number }[] = [
  { pattern: /\b(day after tomorrow|parso|two days later|2 days later)\b/i, days: 2 },
  { pattern: /\b(tomorrow|kal|next day)\b/i, days: 1 },
  { pattern: /\byesterday\b/i, days: -1 },
  { pattern: /\b(today|aaj|abhi|this (morning|afternoon|evening))\b/i, days: 0 },
];

const WEEKDAYS: { pattern: RegExp; isoWeekday: number }[] = [
  { pattern: /\b(monday|mon)\b/i, isoWeekday: 1 },
  { pattern: /\b(tuesday|tue|tues)\b/i, isoWeekday: 2 },
  { pattern: /\b(wednesday|wed)\b/i, isoWeekday: 3 },
  { pattern: /\b(thursday|thu|thur)\b/i, isoWeekday: 4 },
  { pattern: /\b(friday|fri)\b/i, isoWeekday: 5 },
  { pattern: /\b(saturday|sat)\b/i, isoWeekday: 6 },
  { pattern: /\b(sunday|sun)\b/i, isoWeekday: 7 },
];

function anchorOf(context: ResolutionContext): DateTime {
  return DateTime.fromJSDate(context.messageTimestamp, { zone: context.timezone });
}

/** The message's own calendar date in the user's timezone (yyyy-MM-dd). */
export function messageLocalDate(context: ResolutionContext): string {
  return anchorOf(context).toISODate() ?? '';
}

/**
 * Resolves a date phrase against the MESSAGE timestamp - never the server
 * clock. Returns null when the message states no date, so callers can route the
 * change to review instead of inventing one.
 */
export function resolveOccurrenceDate(
  expression: string | null,
  context: ResolutionContext,
): string | null {
  const text = expression?.trim();
  if (!text) {
    return null;
  }

  const anchor = anchorOf(context);

  for (const entry of RELATIVE_DAYS) {
    if (entry.pattern.test(text)) {
      return anchor.plus({ days: entry.days }).toISODate();
    }
  }

  for (const entry of WEEKDAYS) {
    if (entry.pattern.test(text)) {
      const delta = (entry.isoWeekday - anchor.weekday + 7) % 7;
      return anchor.plus({ days: delta }).toISODate();
    }
  }

  return parseExplicitDate(text);
}

function parseExplicitDate(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso?.[1] && iso[2] && iso[3]) {
    const parsed = DateTime.fromISO(`${iso[1]}-${iso[2]}-${iso[3]}`, { zone: 'utc' });
    return parsed.isValid ? parsed.toISODate() : null;
  }

  // Indian convention: dd/mm/yyyy
  const dayFirst = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (dayFirst?.[1] && dayFirst[2] && dayFirst[3]) {
    const parsed = DateTime.fromObject(
      { day: Number(dayFirst[1]), month: Number(dayFirst[2]), year: Number(dayFirst[3]) },
      { zone: 'utc' },
    );
    return parsed.isValid ? parsed.toISODate() : null;
  }

  return null;
}

/** ISO weekday (1 = Monday ... 7 = Sunday) for a yyyy-MM-dd date. */
export function isoWeekdayOf(occurrenceDate: string): number | null {
  const parsed = DateTime.fromISO(occurrenceDate, { zone: 'utc' });
  return parsed.isValid ? parsed.weekday : null;
}

const TIME_TOKEN = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
/** A time must actually look like one - "the 3rd time" is not 03:00. */
const TIME_EVIDENCE = /(\d{1,2}:\d{2})|(\b\d{1,2}\s*(am|pm)\b)/i;
const RANGE_PATTERN = /\d\s*[-â€“â€”]\s*\d|\b(to|thru|till)\b/i;
const REPLACEMENT_PATTERN = /\b(instead|rather than)\b/i;

export interface ResolvedTimeExpression {
  /** New start time when the message states one. */
  startTime?: string;
  /** New end time only when the message states an explicit range. */
  endTime?: string;
  /** Every time mentioned, in order (used to sanity-check the target entry). */
  mentioned: string[];
  /** True for "11 instead of 9" - the later time is the *previous* start. */
  isReplacement: boolean;
}

/** Parses "2 PM", "11:00-12:00", "10 am to 12 pm", "11 instead of 9". */
export function resolveTimeExpression(expression: string | null): ResolvedTimeExpression | null {
  const text = expression?.trim();
  if (!text) {
    return null;
  }

  // Either it looks like a clock value ("11:00", "4 pm") or it is relational
  // ("11 instead of 9", "10 am to 12 pm"). Bare numbers elsewhere are not times.
  const relational = RANGE_PATTERN.test(text) || REPLACEMENT_PATTERN.test(text);
  if (!TIME_EVIDENCE.test(text) && !relational) {
    return null;
  }

  const mentioned: string[] = [];
  for (const match of text.matchAll(TIME_TOKEN)) {
    const normalized = normalizeTimeToken(match[1], match[2], match[3]);
    if (normalized) {
      mentioned.push(normalized);
    }
  }

  const [first, second] = mentioned;
  if (!first) {
    return null;
  }

  const isReplacement = REPLACEMENT_PATTERN.test(text);
  const isRange = !isReplacement && RANGE_PATTERN.test(text) && Boolean(second);

  return {
    startTime: first,
    endTime: isRange ? second : undefined,
    mentioned,
    isReplacement,
  };
}

function normalizeTimeToken(
  hourText: string | undefined,
  minuteText: string | undefined,
  meridiem: string | undefined,
): string | null {
  if (hourText === undefined) {
    return null;
  }

  let hour = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  const meridiemLower = meridiem?.toLowerCase();

  if (meridiemLower === 'pm' && hour < 12) {
    hour += 12;
  }
  if (meridiemLower === 'am' && hour === 12) {
    hour = 0;
  }
  if (hour > 23 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Minutes between two 'HH:mm' times. */
export function minutesBetween(startTime: string, endTime: string): number {
  return minutesOf(endTime) - minutesOf(startTime);
}

/** Adds minutes to an 'HH:mm' time, wrapping at midnight. */
export function addMinutes(time: string, minutes: number): string {
  const total = (minutesOf(time) + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function minutesOf(time: string): number {
  const [hourText = '0', minuteText = '0'] = time.split(':');
  return Number(hourText) * 60 + Number(minuteText);
}