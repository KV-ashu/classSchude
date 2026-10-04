import { parse } from 'csv-parse/sync';
import { timetableRowSchema, type ImportRowError, type TimetableRow } from './import.schemas';

export interface ParsedRows {
  rows: TimetableRow[];
  errors: ImportRowError[];
}

/**
 * Header aliases so real-world spreadsheets map onto the canonical schema.
 * Keys are normalized (lowercased, non-alphanumerics removed).
 */
const FIELD_ALIASES: Record<string, string> = {
  coursecode: 'courseCode',
  course: 'courseCode',
  code: 'courseCode',
  subject: 'courseCode',
  coursename: 'courseCode',
  name: 'courseCode',
  day: 'day',
  weekday: 'day',
  dayofweek: 'day',
  starttime: 'startTime',
  start: 'startTime',
  from: 'startTime',
  time: 'startTime',
  endtime: 'endTime',
  end: 'endTime',
  to: 'endTime',
  room: 'room',
  venue: 'room',
  classroom: 'room',
  location: 'room',
  hall: 'room',
  kind: 'kind',
  type: 'kind',
};

function normalizeKey(key: string): string {
  const normalized = key.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return FIELD_ALIASES[normalized] ?? normalized;
}

function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[normalizeKey(key)] = value;
  }
  return normalized;
}

function validateRows(rawRows: Record<string, unknown>[]): ParsedRows {
  const rows: TimetableRow[] = [];
  const errors: ImportRowError[] = [];

  rawRows.forEach((raw, index) => {
    const result = timetableRowSchema.safeParse(normalizeRecord(raw));
    if (result.success) {
      rows.push(result.data);
      return;
    }

    const issue = result.error.issues[0];
    errors.push({
      row: index + 1,
      field: issue?.path.join('.'),
      message: issue?.message ?? 'invalid row',
      raw,
    });
  });

  return { rows, errors };
}

/** Parses a CSV payload with a header row into validated timetable rows. */
export function parseCsvImport(csv: string): ParsedRows {
  const records = parse(csv, {
    columns: (header: string[]) => header.map(normalizeKey),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, unknown>[];

  return validateRows(records);
}

/** Validates JSON entries (already structured objects). */
export function parseJsonEntries(entries: Record<string, unknown>[]): ParsedRows {
  return validateRows(entries);
}