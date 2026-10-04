import { TIMETABLE_ENTRY_KINDS } from '@classsync/shared';
import { z } from 'zod';

export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm (24-hour)');

/**
 * Canonical row shape every import channel normalizes into (CSV, JSON and
 * Gemini vision all end up here before anything is written to the database).
 */
export const timetableRowSchema = z
  .object({
    courseCode: z.string().trim().min(1, 'courseCode is required').max(40),
    day: z.coerce.number().int().min(1, 'day must be an ISO weekday (1 = Monday)').max(7),
    startTime: timeStringSchema,
    endTime: timeStringSchema,
    room: z.string().trim().max(40).optional(),
    kind: z.enum(TIMETABLE_ENTRY_KINDS).default('LECTURE'),
  })
  .refine((row) => row.endTime > row.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });

export type TimetableRow = z.infer<typeof timetableRowSchema>;

export interface ImportRowError {
  /** 1-based row number as seen by the caller. */
  row: number;
  field?: string;
  message: string;
  raw?: unknown;
}

export const csvImportBodySchema = z.object({
  csv: z.string().min(1, 'csv payload is required').max(200_000),
  createMissingCourses: z.boolean().default(false),
});

export const jsonImportBodySchema = z.object({
  entries: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, 'entries cannot be empty')
    .max(200, 'at most 200 entries per import'),
  createMissingCourses: z.boolean().default(false),
});

export const imageImportBodySchema = z.object({
  // Accepts a raw base64 payload; data-URL prefixes are stripped server side.
  imageBase64: z.string().min(1, 'imageBase64 is required').max(20_000_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/heic']).default('image/png'),
  createMissingCourses: z.boolean().default(false),
});

export const updateEntryBodySchema = z.object({
  day: z.coerce.number().int().min(1).max(7).optional(),
  startTime: timeStringSchema.optional(),
  endTime: timeStringSchema.optional(),
  room: z.string().trim().max(40).nullable().optional(),
  kind: z.enum(TIMETABLE_ENTRY_KINDS).optional(),
});

export const listEntriesQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
});

export type CsvImportBody = z.infer<typeof csvImportBodySchema>;
export type JsonImportBody = z.infer<typeof jsonImportBodySchema>;
export type ImageImportBody = z.infer<typeof imageImportBodySchema>;
export type UpdateEntryBody = z.infer<typeof updateEntryBodySchema>;