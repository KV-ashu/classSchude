import { User, type UserDocument } from '../models/index';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  college?: string;
  timezone?: string;
}

export async function createUser(input: CreateUserInput): Promise<UserDocument> {
  return User.create(input);
}

/** Includes the password hash - only for authentication flows. */
export async function findUserForAuth(email: string): Promise<UserDocument | null> {
  return User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
}

export async function findUserById(userId: string): Promise<UserDocument | null> {
  return User.findById(userId);
}
