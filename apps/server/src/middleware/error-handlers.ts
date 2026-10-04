import type { ErrorRequestHandler, RequestHandler } from 'express';

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
 * Last-resort error handler. Unexpected failures surface as a structured
 * JSON response instead of crashing the process.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('[classsync-server] unhandled request error:', err);
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message },
  });
};
