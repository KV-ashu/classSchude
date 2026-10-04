import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  code: string;
  message: string;
}

/**
 * Per-IP limiter with draft-7 standard headers. Responses use the same
 * `{ ok: false, error }` envelope as every other API error.
 */
export function createRateLimiter(options: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: { code: options.code, message: options.message } },
  });
}

/** Brute-force protection for register/login. */
export const authRateLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  code: 'RATE_LIMITED',
  message: 'Too many authentication attempts - please try again shortly',
});

/** Abuse protection for message ingestion (LLM calls cost money). */
export const messageRateLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.MESSAGE_RATE_LIMIT_MAX,
  code: 'RATE_LIMITED',
  message: 'Too many messages ingested - slow down a moment',
});