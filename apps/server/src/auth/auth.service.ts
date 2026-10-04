import { ApiError } from '../errors';
import type { UserDocument } from '../models/index';
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserForAuth,
} from '../repositories/user.repository';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken } from './tokens';
import type { AuthResult, PublicUser } from './auth.types';
import type { LoginBody, RegisterBody } from './auth.schemas';

function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    college: user.college ?? null,
    timezone: user.timezone,
  };
}

/** Creates an account and issues an access token. */
export async function registerUser(body: RegisterBody): Promise<AuthResult> {
  const existing = await findUserByEmail(body.email);
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(body.password);
  const user = await createUser({
    email: body.email,
    passwordHash,
    displayName: body.displayName,
    college: body.college,
    timezone: body.timezone,
  });

  return {
    user: toPublicUser(user),
    token: await signAccessToken({ userId: user.id, email: user.email }),
  };
}

/** Verifies credentials and issues an access token. */
export async function loginUser(body: LoginBody): Promise<AuthResult> {
  const user = await findUserForAuth(body.email);
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    // Identical message for unknown email and wrong password: no account enumeration.
    throw ApiError.unauthorized('Invalid email or password');
  }

  return {
    user: toPublicUser(user),
    token: await signAccessToken({ userId: user.id, email: user.email }),
  };
}

/** Loads the profile behind an access token. */
export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await findUserById(userId);
  if (!user) {
    throw ApiError.unauthorized('Account no longer exists');
  }
  return toPublicUser(user);
}