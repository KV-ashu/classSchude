import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { requireAuth, requireAuthContext } from '../auth/auth.middleware';
import { ApiError } from '../errors';
import { requireObjectIdParam } from '../http/require-object-id-param';
import { createLlmProvider } from '../llm/factory';
import { Course, TimetableEntry, type CourseDocument, type TimetableEntryDocument } from '../models/index';
import {
  findLatestBaselineVersion,
  listEntriesByUser,
} from '../repositories/timetable-entry.repository';
import { extractTimetableFromImage, stripDataUrlPrefix } from './image-import';
import {
  csvImportBodySchema,
  imageImportBodySchema,
  jsonImportBodySchema,
  listEntriesQuerySchema,
  updateEntryBodySchema,
} from './import.schemas';
import { parseCsvImport, parseJsonEntries } from './parse';
import { importBaseline, lockCurrentBaseline } from './timetable.service';

export const timetableRouter = Router();

// The whole timetable surface is private.
timetableRouter.use(requireAuth);

interface EntryDto {
  id: string;
  courseId: string;
  courseCode: string | null;
  courseName: string | null;
  day: number;
  startTime: string;
  endTime: string;
  room: string | null;
  kind: string;
  baselineVersion: number;
  locked: boolean;
}

function toEntryDto(entry: TimetableEntryDocument, course?: CourseDocument): EntryDto {
  return {
    id: entry.id,
    courseId: String(entry.courseId),
    courseCode: course?.code ?? null,
    courseName: course?.name ?? null,
    day: entry.dayOfWeek,
    startTime: entry.startTime,
    endTime: entry.endTime,
    room: entry.room ?? null,
    kind: entry.kind,
    baselineVersion: entry.baselineVersion,
    locked: entry.locked,
  };
}

function currentUserId(req: Request): Types.ObjectId {
  return new Types.ObjectId(requireAuthContext(req).userId);
}

timetableRouter.get('/entries', async (req, res) => {
  const userId = currentUserId(req);
  const query = listEntriesQuerySchema.parse(req.query);
  const version = query.version ?? (await findLatestBaselineVersion(userId));

  if (version === 0) {
    res.json({ ok: true, data: { version: null, locked: false, entries: [] } });
    return;
  }

  const entries = await listEntriesByUser(userId, { baselineVersion: version });
  const courseIds = [...new Set(entries.map((entry) => String(entry.courseId)))];
  const courses = await Course.find({ _id: { $in: courseIds } });
  const coursesById = new Map(courses.map((course) => [String(course._id), course]));

  res.json({
    ok: true,
    data: {
      version,
      locked: entries.length > 0 && entries.every((entry) => entry.locked),
      entries: entries.map((entry) => toEntryDto(entry, coursesById.get(String(entry.courseId)))),
    },
  });
});

timetableRouter.post('/import/csv', async (req, res) => {
  const userId = currentUserId(req);
  const body = csvImportBodySchema.parse(req.body);
  const parsed = parseCsvImport(body.csv);

  const result = await importBaseline({
    userId,
    rows: parsed.rows,
    rowErrors: parsed.errors,
    source: 'csv',
    createMissingCourses: body.createMissingCourses,
  });

  res.status(201).json({ ok: true, data: result });
});

timetableRouter.post('/import/json', async (req, res) => {
  const userId = currentUserId(req);
  const body = jsonImportBodySchema.parse(req.body);
  const parsed = parseJsonEntries(body.entries);

  const result = await importBaseline({
    userId,
    rows: parsed.rows,
    rowErrors: parsed.errors,
    source: 'json',
    createMissingCourses: body.createMissingCourses,
  });

  res.status(201).json({ ok: true, data: result });
});

timetableRouter.post('/import/image', async (req, res) => {
  const userId = currentUserId(req);
  const body = imageImportBodySchema.parse(req.body);
  const provider = createLlmProvider();

  const extraction = await extractTimetableFromImage(provider, {
    base64: stripDataUrlPrefix(body.imageBase64),
    mimeType: body.mimeType,
  });

  const result = await importBaseline({
    userId,
    rows: extraction.rows,
    rowErrors: extraction.errors,
    source: 'image',
    createMissingCourses: body.createMissingCourses,
    sourceDetail: `${extraction.model}/${extraction.promptVersion}`,
  });

  res.status(201).json({
    ok: true,
    data: {
      ...result,
      extraction: { model: extraction.model, promptVersion: extraction.promptVersion },
    },
  });
});

/** Review step: edit one draft entry (refused once the baseline is locked). */
timetableRouter.patch('/entries/:id', async (req, res) => {
  const userId = currentUserId(req);
  const entryId = requireObjectIdParam(req.params.id, 'entry id');
  const body = updateEntryBodySchema.parse(req.body);

  const entry = await TimetableEntry.findOne({ _id: entryId, userId });
  if (!entry) {
    throw ApiError.notFound('Timetable entry not found');
  }

  if (body.day !== undefined) {
    entry.dayOfWeek = body.day;
  }
  if (body.startTime !== undefined) {
    entry.startTime = body.startTime;
  }
  if (body.endTime !== undefined) {
    entry.endTime = body.endTime;
  }
  if (body.room !== undefined) {
    entry.room = body.room ?? undefined;
  }
  if (body.kind !== undefined) {
    entry.kind = body.kind;
  }

  if (entry.endTime <= entry.startTime) {
    throw ApiError.badRequest('endTime must be after startTime');
  }

  // A locked entry throws BaselineImmutableError -> mapped to 409 by the error handler.
  await entry.save();

  res.json({ ok: true, data: toEntryDto(entry) });
});

timetableRouter.delete('/entries/:id', async (req, res) => {
  const userId = currentUserId(req);
  const entryId = requireObjectIdParam(req.params.id, 'entry id');

  const entry = await TimetableEntry.findOne({ _id: entryId, userId });
  if (!entry) {
    throw ApiError.notFound('Timetable entry not found');
  }

  // The baseline guard refuses this once the version is locked.
  await TimetableEntry.deleteOne({ _id: entryId, userId });

  res.status(204).send();
});

/** Review step: confirm the draft and freeze the baseline. */
timetableRouter.post('/lock', async (req, res) => {
  const userId = currentUserId(req);
  const result = await lockCurrentBaseline(userId);
  res.json({ ok: true, data: result });
});