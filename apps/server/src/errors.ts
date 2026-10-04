import { ZodError } from 'zod';

/**
 * Application-level error carrying an HTTP status, a stable machine-readable
 * code and optional details. Every deliberate failure in the API uses this so
 * the error handler can respond consistently.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static unprocessable(message: string, details?: unknown): ApiError {
    return new ApiError(422, 'UNPROCESSABLE_ENTITY', message, details);
  }

  static badGateway(message: string, details?: unknown): ApiError {
    return new ApiError(502, 'UPSTREAM_ERROR', message, details);
  }

  static serviceUnavailable(message: string): ApiError {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message);
  }
}

/** True when an error is a Zod validation failure. */
export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}