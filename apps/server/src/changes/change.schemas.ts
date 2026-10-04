import { CHANGE_STATUSES } from '@classsync/shared';
import { z } from 'zod';

export const listChangesQuerySchema = z.object({
  status: z.enum([...CHANGE_STATUSES]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const reviewEditsSchema = z.object({
  occurrenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'occurrenceDate must be yyyy-mm-dd')
    .optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be HH:mm')
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime must be HH:mm')
    .optional(),
  room: z.string().trim().max(40).nullable().optional(),
});

export const rejectBodySchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const revertBodySchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const effectiveQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be yyyy-mm-dd'),
});

export type ReviewEditsBody = z.infer<typeof reviewEditsSchema>;