import {
  CHANGE_STATUSES,
  SCHEDULE_CHANGE_ACTIONS,
  TIMETABLE_ENTRY_KINDS,
  type ChangeStatus,
  type ScheduleChangeAction,
  type TimetableEntryKind,
} from '@classsync/shared';
import { model, Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { DATE_PATTERN, TIME_PATTERN } from './validation';

/** Who (or what) applied a change. */
export const APPLIED_BY = ['AI', 'USER'] as const;
export type AppliedBy = (typeof APPLIED_BY)[number];

/** Snapshot of the affected fields before/after a change. */
export interface ChangeValueSnapshot {
  startTime?: string;
  endTime?: string;
  room?: string;
  kind?: TimetableEntryKind;
}

/** Deterministic confidence score factors, stored for explainability. */
export interface ConfidenceFactors {
  certainty?: number;
  aliasMatch?: number;
  ambiguityPenalty?: number;
  conflictPenalty?: number;
}

export interface ScheduleChangeDoc {
  userId: Types.ObjectId;
  rawMessageId: Types.ObjectId;
  targetEntryId: Types.ObjectId;
  /** Calendar date (yyyy-mm-dd) the change applies to, resolved in the user's timezone. */
  occurrenceDate: string;
  action: ScheduleChangeAction;
  oldValue?: ChangeValueSnapshot;
  newValue?: ChangeValueSnapshot;
  /** 0..1 - routed against CONFIDENCE_THRESHOLDS (>=0.90 apply, >=0.70 review). */
  confidence: number;
  confidenceFactors?: ConfidenceFactors;
  status: ChangeStatus;
  appliedBy: AppliedBy;
  revertedByAuditId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const valueSnapshotSchema = new Schema<ChangeValueSnapshot>(
  {
    startTime: { type: String, match: [TIME_PATTERN, 'startTime must be HH:mm (24h)'] },
    endTime: { type: String, match: [TIME_PATTERN, 'endTime must be HH:mm (24h)'] },
    room: { type: String, trim: true, maxlength: 40 },
    kind: { type: String, enum: [...TIMETABLE_ENTRY_KINDS] },
  },
  { _id: false },
);

const confidenceFactorsSchema = new Schema<ConfidenceFactors>(
  {
    certainty: { type: Number, min: 0, max: 1 },
    aliasMatch: { type: Number, min: 0, max: 1 },
    ambiguityPenalty: { type: Number, min: 0, max: 1 },
    conflictPenalty: { type: Number, min: 0, max: 1 },
  },
  { _id: false },
);

const scheduleChangeSchema = new Schema<ScheduleChangeDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rawMessageId: { type: Schema.Types.ObjectId, ref: 'RawMessage', required: true },
    targetEntryId: { type: Schema.Types.ObjectId, ref: 'TimetableEntry', required: true },
    occurrenceDate: {
      type: String,
      required: true,
      match: [DATE_PATTERN, 'occurrenceDate must be yyyy-mm-dd'],
    },
    action: { type: String, enum: [...SCHEDULE_CHANGE_ACTIONS], required: true },
    oldValue: { type: valueSnapshotSchema },
    newValue: { type: valueSnapshotSchema },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    confidenceFactors: { type: confidenceFactorsSchema },
    status: { type: String, enum: [...CHANGE_STATUSES], required: true, default: 'PENDING_REVIEW' },
    appliedBy: { type: String, enum: [...APPLIED_BY], required: true, default: 'AI' },
    revertedByAuditId: { type: Schema.Types.ObjectId, ref: 'AuditLog' },
  },
  { timestamps: true },
);

// Idempotency key: retries of the same extraction can never double-apply a change.
scheduleChangeSchema.index(
  { rawMessageId: 1, action: 1, targetEntryId: 1, occurrenceDate: 1 },
  { unique: true },
);
scheduleChangeSchema.index({ userId: 1, occurrenceDate: 1 });
scheduleChangeSchema.index({ status: 1 });

export type ScheduleChangeDocument = HydratedDocument<ScheduleChangeDoc>;
export const ScheduleChange: Model<ScheduleChangeDoc> = model<ScheduleChangeDoc>(
  'ScheduleChange',
  scheduleChangeSchema,
);
