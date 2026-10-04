import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env';

export interface AccessTokenClaims {
  userId: string;
  email: string;
}

function signingKey(): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

/** Issues a signed HS256 access token for an account. */
export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(signingKey());
}

/** Verifies a token and returns its claims. Throws when invalid, tampered or expired. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Malformed access token payload');
  }
  return { userId: payload.sub, email: payload.email };
}