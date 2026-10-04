import { logger } from '../config/logger';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../errors';
import { BaselineImmutableError } from '../models/errors';
import { isDuplicateKeyError } from '../utils/mongo-errors';

/** Unmatched route handler - returns a structured 404 payload. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
};

/**
 * Central error translation. Deliberate failures (ApiError, validation,
 * immutability guards, duplicate keys) become structured JSON responses;
 * anything unexpected is logged and returned as a generic 500.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: err.issues,
      },
    });
    return;
  }

  if (err instanceof BaselineImmutableError) {
    res.status(409).json({
      ok: false,
      error: { code: 'BASELINE_IMMUTABLE', message: err.message },
    });
    return;
  }

  if (isDuplicateKeyError(err)) {
    res.status(409).json({
      ok: false,
      error: { code: 'DUPLICATE_KEY', message: 'Resource already exists' },
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  logger.error({ error: err }, 'unhandled request error');
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message },
  });
};
