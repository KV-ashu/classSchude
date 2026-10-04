import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { requireAuth, requireAuthContext } from '../auth/auth.middleware';
import { ApiError } from '../errors';
import { requireObjectIdParam, requireParam } from '../http/require-object-id-param';
import { Course, TimetableEntry, type CourseDocument } from '../models/index';
import { createCourse, findCourseById, listCoursesByUser } from '../repositories/course.repository';
import {
  addAliasBodySchema,
  createCourseBodySchema,
  updateCourseBodySchema,
} from './course.schemas';

export const courseRouter = Router();

// Every course endpoint requires a verified account.
courseRouter.use(requireAuth);

interface CourseDto {
  id: string;
  name: string;
  code: string;
  aliases: string[];
  defaultRoom: string | null;
  defaultDurationMin: number | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toCourseDto(course: CourseDocument): CourseDto {
  return {
    id: course.id,
    name: course.name,
    code: course.code,
    aliases: course.aliases,
    defaultRoom: course.defaultRoom ?? null,
    defaultDurationMin: course.defaultDurationMin ?? null,
    color: course.color ?? null,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

function currentUserId(req: Request): Types.ObjectId {
  return new Types.ObjectId(requireAuthContext(req).userId);
}

/** Loads a course that belongs to the caller, or 404 (never leaks existence). */
async function requireOwnedCourse(courseId: string, userId: Types.ObjectId): Promise<CourseDocument> {
  const course = await findCourseById(courseId);
  if (!course || !course.userId.equals(userId)) {
    throw ApiError.notFound('Course not found');
  }
  return course;
}

courseRouter.post('/', async (req, res) => {
  const userId = currentUserId(req);
  const body = createCourseBodySchema.parse(req.body);
  const course = await createCourse({ userId, ...body });
  res.status(201).json({ ok: true, data: toCourseDto(course) });
});

courseRouter.get('/', async (req, res) => {
  const userId = currentUserId(req);
  const courses = await listCoursesByUser(userId);
  res.json({ ok: true, data: courses.map(toCourseDto) });
});

courseRouter.get('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const course = await requireOwnedCourse(requireObjectIdParam(req.params.id, 'course id'), userId);
  res.json({ ok: true, data: toCourseDto(course) });
});

courseRouter.patch('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const course = await requireOwnedCourse(requireObjectIdParam(req.params.id, 'course id'), userId);
  const body = updateCourseBodySchema.parse(req.body);

  if (body.name !== undefined) {
    course.name = body.name;
  }
  if (body.code !== undefined) {
    course.code = body.code;
  }
  if (body.defaultRoom !== undefined) {
    course.defaultRoom = body.defaultRoom;
  }
  if (body.defaultDurationMin !== undefined) {
    course.defaultDurationMin = body.defaultDurationMin;
  }
  if (body.color !== undefined) {
    course.color = body.color;
  }
  if (body.aliases !== undefined) {
    // Aliases are additive - they are removed through the dedicated endpoint.
    course.aliases = [...new Set([...course.aliases, ...body.aliases])];
  }

  await course.save();
  res.json({ ok: true, data: toCourseDto(course) });
});

courseRouter.post('/:id/aliases', async (req, res) => {
  const userId = currentUserId(req);
  const course = await requireOwnedCourse(requireObjectIdParam(req.params.id, 'course id'), userId);
  const { alias } = addAliasBodySchema.parse(req.body);

  if (!course.aliases.includes(alias)) {
    course.aliases = [...course.aliases, alias];
    await course.save();
  }
  res.status(201).json({ ok: true, data: toCourseDto(course) });
});

courseRouter.delete('/:id/aliases/:alias', async (req, res) => {
  const userId = currentUserId(req);
  const course = await requireOwnedCourse(requireObjectIdParam(req.params.id, 'course id'), userId);
  const alias = decodeURIComponent(requireParam(req.params.alias, 'alias'));

  course.aliases = course.aliases.filter(
    (existing) => existing.toLowerCase() !== alias.toLowerCase(),
  );
  await course.save();
  res.json({ ok: true, data: toCourseDto(course) });
});

courseRouter.delete('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const course = await requireOwnedCourse(requireObjectIdParam(req.params.id, 'course id'), userId);

  const referencingEntries = await TimetableEntry.countDocuments({ courseId: course._id });
  if (referencingEntries > 0) {
    throw ApiError.conflict('Course is referenced by timetable entries', {
      referencingEntries,
    });
  }

  await Course.deleteOne({ _id: course._id });
  res.status(204).send();
});