import { TIMETABLE_ENTRY_KINDS, type TimetableEntryKind } from '@classsync/shared';
import { model, Schema, type HydratedDocument, type Model, type Query, type Types } from 'mongoose';
import { BaselineImmutableError } from './errors';
import { TIME_PATTERN } from './validation';

/**
 * A baseline timetable entry (the original, user-confirmed timetable).
 *
 * Baseline vs Effective contract: these documents are the BASELINE and are
 * immutable once locked. Schedule changes never mutate them - the effective
 * timetable is derived from baseline + applied changes. Locked entries can
 * never be modified or deleted; a re-import creates baselineVersion + 1.
 */
export interface TimetableEntryDoc {
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  dayOfWeek: number;
  /** 'HH:mm' 24-hour clock. */
  startTime: string;
  endTime: string;
  room?: string;
  kind: TimetableEntryKind;
  baselineVersion: number;
  /** Once true this entry is part of the confirmed baseline and is immutable. */
  locked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimetableEntryModel extends Model<TimetableEntryDoc> {
  /**
   * Confirms (locks) every unlocked entry of a baseline version. This is the
   * only sanctioned way to set `locked` - it never touches already-locked docs.
   */
  lockBaseline(userId: Types.ObjectId, baselineVersion: number): Promise<number>;
  /**
   * Internal-only escape hatch that writes a locked baseline entry, bypassing
   * the immutability guard (supervised migrations / repair scripts only).
   * Request handlers must never call this.
   */
  updateInternal(entryId: string | Types.ObjectId, patch: Record<string, unknown>): Promise<number>;
}

/**
 * Options accepted by updateOne on this model. Mongoose 9 does not export
 * `UpdateOptions`, so it is derived from the model signature instead.
 */
type TimetableEntryUpdateOptions = NonNullable<Parameters<TimetableEntryModel['updateOne']>[2]>;

const timetableEntrySchema = new Schema<TimetableEntryDoc, TimetableEntryModel>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    dayOfWeek: { type: Number, required: true, min: 1, max: 7 },
    startTime: {
      type: String,
      required: true,
      match: [TIME_PATTERN, 'startTime must be HH:mm (24h)'],
    },
    endTime: {
      type: String,
      required: true,
      match: [TIME_PATTERN, 'endTime must be HH:mm (24h)'],
    },
    room: { type: String, trim: true, maxlength: 40 },
    kind: { type: String, enum: [...TIMETABLE_ENTRY_KINDS], required: true, default: 'LECTURE' },
    baselineVersion: { type: Number, required: true, min: 1, default: 1 },
    locked: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

timetableEntrySchema.index({ userId: 1, baselineVersion: -1 });
timetableEntrySchema.index({ userId: 1, dayOfWeek: 1, startTime: 1 });

/* ----------------------- Baseline immutability guards ---------------------- */

const WRITE_OPERATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'replaceOne',
  'deleteOne',
  'deleteMany',
] as const;

function isBaselineGuardSkipped(options: Record<string, unknown> | undefined): boolean {
  return options?.['skipBaselineGuard'] === true;
}

timetableEntrySchema.pre('validate', function () {
  if (this.startTime && this.endTime && this.endTime <= this.startTime) {
    this.invalidate('endTime', 'endTime must be after startTime');
  }
});

// Document-level guard: an existing entry that is (or was) locked can never be
// saved again - covering field edits and direct lock flips.
timetableEntrySchema.pre('save', async function () {
  if (this.isNew || !this.isModified()) {
    return;
  }
  if (isBaselineGuardSkipped(this.$locals as Record<string, unknown>)) {
    return;
  }
  const persisted = await TimetableEntry.findById(this._id)
    .select('locked')
    .lean<{ locked?: boolean } | null>();
  if (persisted?.locked === true || this.locked) {
    throw new BaselineImmutableError(`save of entry ${String(this._id)}`);
  }
});

// Query-level guard: any write operation whose filter would match a locked
// entry is refused. Unlocked targets stay fully editable.
timetableEntrySchema.pre([...WRITE_OPERATIONS], async function (this: Query<unknown, unknown>) {
  const options = this.getOptions() as Record<string, unknown>;
  if (isBaselineGuardSkipped(options)) {
    return;
  }
  const filter = this.getFilter() as Record<string, unknown>;
  if (filter['locked'] === false) {
    // The filter explicitly excludes locked entries, so it cannot match one.
    return;
  }
  const lockedTargets = await this.model.countDocuments({ ...filter, locked: true });
  if (lockedTargets > 0) {
    // Mongoose 9 no longer exposes `op` on the Query type - read it defensively.
    const operation = (this as unknown as { op?: string }).op ?? 'write';
    throw new BaselineImmutableError(
      `${operation} would affect ${lockedTargets} locked entr${lockedTargets === 1 ? 'y' : 'ies'}`,
    );
  }
});

/* --------------------------------- Statics --------------------------------- */

timetableEntrySchema.statics.lockBaseline = async function lockBaseline(
  this: TimetableEntryModel,
  userId: Types.ObjectId,
  baselineVersion: number,
): Promise<number> {
  const result = await this.updateMany(
    { userId, baselineVersion, locked: false },
    { $set: { locked: true } },
  );
  return result.modifiedCount;
};

timetableEntrySchema.statics.updateInternal = async function updateInternal(
  this: TimetableEntryModel,
  entryId: string | Types.ObjectId,
  patch: Record<string, unknown>,
): Promise<number> {
  // The guard bypass is deliberate and confined to this internal static.
  const options = { skipBaselineGuard: true } as TimetableEntryUpdateOptions;
  const result = await this.updateOne({ _id: entryId }, { $set: patch }, options);
  return result.modifiedCount;
};

export type TimetableEntryDocument = HydratedDocument<TimetableEntryDoc>;
export const TimetableEntry = model<TimetableEntryDoc, TimetableEntryModel>(
  'TimetableEntry',
  timetableEntrySchema,
);
