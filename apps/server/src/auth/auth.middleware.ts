import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../errors';
import { getProfile } from './auth.service';
import { verifyAccessToken } from './tokens';
import type { AuthContext } from './auth.types';

function readBearerToken(req: Request): string {
  const header = req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    throw ApiError.unauthorized('Missing bearer token');
  }

  const token = header.slice('bearer '.length).trim();
  if (token.length === 0) {
    throw ApiError.unauthorized('Missing bearer token');
  }
  return token;
}

/**
 * Verifies the JWT, loads the account and attaches it to the request.
 * Any failure becomes a 401 - never a raw 500.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = readBearerToken(req);
    const claims = await verifyAccessToken(token);
    const profile = await getProfile(claims.userId);
    req.auth = { userId: profile.id, email: profile.email };
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : ApiError.unauthorized('Invalid or expired token'));
  }
};

/** Reads the authenticated context; throws when a handler runs without requireAuth. */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.auth) {
    throw ApiError.unauthorized();
  }
  return req.auth;
}