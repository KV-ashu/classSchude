import { z } from 'zod';

export const aliasSchema = z.string().trim().min(1, 'alias cannot be empty').max(60);

export const createCourseBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  code: z.string().trim().min(1, 'code is required').max(24),
  aliases: z.array(aliasSchema).max(20).default([]),
  defaultRoom: z.string().trim().max(40).optional(),
  defaultDurationMin: z.number().int().min(5).max(480).optional(),
  color: z.string().trim().max(24).optional(),
});

export const updateCourseBodySchema = createCourseBodySchema.partial();

export const addAliasBodySchema = z.object({
  alias: aliasSchema,
});

export type CreateCourseBody = z.infer<typeof createCourseBodySchema>;
export type UpdateCourseBody = z.infer<typeof updateCourseBodySchema>;