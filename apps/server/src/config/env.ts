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

  // Observability
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Rate limiting (per IP, per account endpoint group)
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  MESSAGE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),

  // Background worker that drains ingested messages into the pipeline
  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(250).default(4_000),

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
