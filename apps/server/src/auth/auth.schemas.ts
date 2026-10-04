import { DEFAULT_TIMEZONE } from '@classsync/shared';
import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('a valid email address is required'));

/** scrypt hashes are fixed length; bcrypt-style 72 byte limits are enforced by Mongoose. */
export const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(200, 'password must be at most 200 characters');

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1, 'displayName is required').max(80),
  college: z.string().trim().max(120).optional(),
  timezone: z.string().trim().min(1).max(64).default(DEFAULT_TIMEZONE),
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'password is required'),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;