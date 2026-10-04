import { DEFAULT_TIMEZONE } from '@classsync/shared';
import { model, Schema, type HydratedDocument, type Model } from 'mongoose';

export interface UserDoc {
  email: string;
  /** Excluded from queries by default (select: false) - fetched explicitly for auth only. */
  passwordHash: string;
  displayName: string;
  college?: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    college: { type: String, trim: true, maxlength: 120 },
    timezone: { type: String, required: true, default: DEFAULT_TIMEZONE, trim: true },
  },
  { timestamps: true },
);

export type UserDocument = HydratedDocument<UserDoc>;
export const User: Model<UserDoc> = model<UserDoc>('User', userSchema);
