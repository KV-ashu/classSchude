import type { Types } from 'mongoose';
import { ApiError } from '../errors';
import { Course, TimetableEntry, type CourseDocument } from '../models/index';
import { appendAuditLog } from '../repositories/audit-log.repository';
import {
  createManyTimetableEntries,
  findLatestBaselineVersion,
  listEntriesByUser,
  lockBaseline,
} from '../repositories/timetable-entry.repository';
import type { ImportRowError, TimetableRow } from './import.schemas';

export type ImportSource = 'csv' | 'json' | 'image';

export interface ImportBaselineOptions {
  userId: Types.ObjectId;
  rows: TimetableRow[];
  rowErrors: ImportRowError[];
  source: ImportSource;
  createMissingCourses: boolean;
  /** Extra provenance stored on the audit entry (e.g. the model that read an image). */
  sourceDetail?: string;
}

export interface ImportBaselineResult {
  version: number;
  importedCount: number;
  createdCourseCodes: string[];
  replacedDraft: boolean;
}

export interface LockBaselineResult {
  version: number;
  lockedCount: number;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Detects classes that overlap each other inside a single import batch. */
function findOverlaps(rows: TimetableRow[]): ImportRowError[] {
  const errors: ImportRowError[] = [];

  rows.forEach((row, index) => {
    rows.slice(index + 1).forEach((other, offset) => {
      if (other.day === row.day && row.startTime < other.endTime && other.startTime < row.endTime) {
        errors.push({
          row: index + 1,
          field: 'startTime',
          message: `Overlaps row ${index + offset + 2} (${other.startTime}-${other.endTime})`,
          raw: row,
        });
      }
    });
  });

  return errors;
}

async function resolveCourses(
  userId: Types.ObjectId,
  rows: TimetableRow[],
  createMissingCourses: boolean,
): Promise<{ coursesByCode: Map<string, CourseDocument>; createdCodes: string[] }> {
  const codes = [...new Set(rows.map((row) => normalizeCode(row.courseCode)))];
  const existing = await Course.find({ userId, code: { $in: codes } });
  const coursesByCode = new Map<string, CourseDocument>(
    existing.map((course) => [course.code, course]),
  );

  const createdCodes: string[] = [];
  const errors: ImportRowError[] = [];

  for (const row of rows) {
    const code = normalizeCode(row.courseCode);
    if (coursesByCode.has(code)) {
      continue;
    }

    if (!createMissingCourses) {
      errors.push({
        row: 0,
        field: 'courseCode',
        message: `Unknown course '${row.courseCode}' - create it first or set createMissingCourses`,
        raw: row,
      });
      continue;
    }

    const created = await Course.create({
      userId,
      name: row.courseCode.trim(),
      code,
      aliases: [],
      ...(row.room ? { defaultRoom: row.room } : {}),
    });
    coursesByCode.set(code, created);
    createdCodes.push(code);
  }

  if (errors.length > 0) {
    throw ApiError.unprocessable('Timetable import references unknown courses', { errors });
  }

  return { coursesByCode, createdCodes };
}

/**
 * Imports a baseline draft. All-or-nothing: invalid rows or overlapping
 * classes abort the whole import, otherwise every row lands as an unlocked
 * draft entry that the user reviews and then locks.
 */
export async function importBaseline(
  options: ImportBaselineOptions,
): Promise<ImportBaselineResult> {
  if (options.rowErrors.length > 0) {
    throw ApiError.unprocessable('Timetable import contains invalid rows', {
      errors: options.rowErrors,
    });
  }

  if (options.rows.length === 0) {
    throw ApiError.unprocessable('Timetable import contains no rows');
  }

  const overlaps = findOverlaps(options.rows);
  if (overlaps.length > 0) {
    throw ApiError.unprocessable('Timetable import contains overlapping classes', {
      errors: overlaps,
    });
  }

  const { coursesByCode, createdCodes } = await resolveCourses(
    options.userId,
    options.rows,
    options.createMissingCourses,
  );

  const latestVersion = await findLatestBaselineVersion(options.userId);
  let version = latestVersion === 0 ? 1 : latestVersion;
  let replacedDraft = false;

  if (latestVersion > 0) {
    const currentEntries = await listEntriesByUser(options.userId, {
      baselineVersion: latestVersion,
    });
    const hasDraft = currentEntries.some((entry) => !entry.locked);

    if (hasDraft) {
      // Re-importing replaces the unconfirmed draft instead of piling versions up.
      await TimetableEntry.deleteMany({
        userId: options.userId,
        baselineVersion: latestVersion,
        locked: false,
      });
      replacedDraft = true;
    } else {
      version = latestVersion + 1;
    }
  }

  const documents = options.rows.map((row) => {
    const courseId = coursesByCode.get(normalizeCode(row.courseCode))?._id;
    if (!courseId) {
      // Unreachable: resolveCourses already validated every row.
      throw ApiError.unprocessable(`Unknown course '${row.courseCode}'`);
    }

    return {
      userId: options.userId,
      courseId,
      dayOfWeek: row.day,
      startTime: row.startTime,
      endTime: row.endTime,
      room: row.room,
      kind: row.kind,
      baselineVersion: version,
      locked: false,
    };
  });

  const created = await createManyTimetableEntries(documents);

  await appendAuditLog({
    userId: options.userId,
    actor: 'USER',
    action: 'BASELINE_IMPORTED',
    reason:
      `${options.source} import: ${created.length} entries (baseline v${version})` +
      (options.sourceDetail ? ` via ${options.sourceDetail}` : ''),
  });

  return {
    version,
    importedCount: created.length,
    createdCourseCodes: createdCodes,
    replacedDraft,
  };
}

/**
 * Confirms the current baseline version: every entry becomes immutable from
 * now on. Only a new import (baselineVersion + 1) can change the timetable.
 */
export async function lockCurrentBaseline(userId: Types.ObjectId): Promise<LockBaselineResult> {
  const version = await findLatestBaselineVersion(userId);
  if (version === 0) {
    throw ApiError.badRequest('Nothing to lock: import a timetable first');
  }

  const entries = await listEntriesByUser(userId, { baselineVersion: version });
  if (entries.length === 0) {
    throw ApiError.badRequest('Nothing to lock: the current baseline has no entries');
  }
  if (entries.every((entry) => entry.locked)) {
    throw ApiError.conflict('The current baseline is already locked');
  }

  const lockedCount = await lockBaseline(userId, version);

  await appendAuditLog({
    userId,
    actor: 'USER',
    action: 'BASELINE_LOCKED',
    reason: `locked ${lockedCount} entries of baseline v${version}`,
  });

  return { version, lockedCount };
}