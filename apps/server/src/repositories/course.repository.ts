import type { Types } from 'mongoose';
import { Course, type CourseDocument } from '../models/index';

export interface CreateCourseInput {
  userId: Types.ObjectId;
  name: string;
  code: string;
  aliases?: string[];
  defaultRoom?: string;
  defaultDurationMin?: number;
  color?: string;
}

export async function createCourse(input: CreateCourseInput): Promise<CourseDocument> {
  return Course.create(input);
}

export async function listCoursesByUser(userId: Types.ObjectId): Promise<CourseDocument[]> {
  return Course.find({ userId }).sort({ code: 1 });
}

export async function findCourseByCode(
  userId: Types.ObjectId,
  code: string,
): Promise<CourseDocument | null> {
  return Course.findOne({ userId, code: code.toUpperCase().trim() });
}

export async function findCourseById(courseId: string): Promise<CourseDocument | null> {
  return Course.findById(courseId);
}
