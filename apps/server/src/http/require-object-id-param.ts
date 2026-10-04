import { ApiError } from '../errors';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Reads a required route parameter and validates that it looks like an
 * ObjectId, so a malformed id never reaches the database layer.
 */
export function requireObjectIdParam(value: string | undefined, name: string): string {
  if (!value || !OBJECT_ID_PATTERN.test(value)) {
    throw ApiError.badRequest(`Invalid ${name}`);
  }
  return value;
}

/** Reads a required route parameter as a non-empty string. */
export function requireParam(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw ApiError.badRequest(`Missing ${name}`);
  }
  return value;
}