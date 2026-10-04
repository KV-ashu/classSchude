import 'dotenv/config';
import { z } from 'zod';

/** The placeholder secret that must never reach production. */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

/** Optional env values arrive as `KEY=` (empty string) - treat those as unset. */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/classsync'),

  JWT_SECRET: z.string().min(8).default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),

  LLM_PROVIDER: z.enum(['stub', 'gemini', 'openai', 'anthropic']).default('stub'),
  LLM_API_KEY: optionalString,
  LLM_MODEL: optionalString,

  TZ_DEFAULT: z.string().min(1).default('Asia/Kolkata'),
});

export type Env = z.infer<typeof envSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Parse and validate an environment source. Throws a readable report when
 * configuration is invalid so the server fails fast at boot.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${formatIssues(parsed.error)}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a unique value in production.');
  }
  return parsed.data;
}

/** Validated environment singleton for the running server. */
export const env = loadEnv();
