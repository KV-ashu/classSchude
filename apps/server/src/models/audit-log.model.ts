import {
  AUDIT_ACTORS,
  TIMETABLE_ENTRY_KINDS,
  type AuditActor,
  type TimetableEntryKind,
} from '@classsync/shared';
import { model, Schema, type HydratedDocument, type Model, type Query, type Types } from 'mongoose';
import { AuditLogImmutableError } from './errors';
import { DATE_PATTERN, TIME_PATTERN } from './validation';

/** Point-in-time representation of the affected timetable entry. */
export interface AuditEntrySnapshot {
  entryId?: string;
  courseId?: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  room?: string | null;
  kind?: TimetableEntryKind;
}

/**
 * Immutable record of every mutation in the system. Entries are append-only:
 * updates and deletes are refused at the schema level. Reverts append a new
 * entry instead of modifying history.
 */
export interface AuditLogDoc {
  userId: Types.ObjectId;
  actor: AuditActor;
  /** e.g. BASELINE_IMPORTED, BASELINE_LOCKED, CHANGE_APPLIED, CHANGE_REVERTED. */
  action: string;
  changeId?: Types.ObjectId;
  targetEntryId?: Types.ObjectId;
  occurrenceDate?: string;
  beforeSnapshot?: AuditEntrySnapshot;
  afterSnapshot?: AuditEntrySnapshot;
  reason?: string;
  createdAt: Date;
}

const auditEntrySnapshotSchema = new Schema<AuditEntrySnapshot>(
  {
    entryId: { type: String, trim: true },
    courseId: { type: String, trim: true },
    dayOfWeek: { type: Number, min: 1, max: 7 },
    startTime: { type: String, match: [TIME_PATTERN, 'startTime must be HH:mm (24h)'] },
    endTime: { type: String, match: [TIME_PATTERN, 'endTime must be HH:mm (24h)'] },
    room: { type: String, trim: true, default: null },
    kind: { type: String, enum: [...TIMETABLE_ENTRY_KINDS] },
  },
  { _id: false },
);

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: String, enum: [...AUDIT_ACTORS], required: true },
    action: { type: String, required: true, trim: true, maxlength: 60 },
    changeId: { type: Schema.Types.ObjectId, ref: 'ScheduleChange' },
    targetEntryId: { type: Schema.Types.ObjectId, ref: 'TimetableEntry' },
    occurrenceDate: { type: String, match: [DATE_PATTERN, 'occurrenceDate must be yyyy-mm-dd'] },
    beforeSnapshot: { type: auditEntrySnapshotSchema },
    afterSnapshot: { type: auditEntrySnapshotSchema },
    reason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ changeId: 1 });

/* ------------------------------ Append-only guard -------------------------- */

const FORBIDDEN_OPERATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'replaceOne',
  'deleteOne',
  'deleteMany',
] as const;

auditLogSchema.pre([...FORBIDDEN_OPERATIONS], function (this: Query<unknown, unknown>) {
  // Mongoose 9 no longer exposes `op` on the Query type - read it defensively.
  const operation = (this as unknown as { op?: string }).op ?? 'write';
  throw new AuditLogImmutableError(operation);
});

export type AuditLogDocument = HydratedDocument<AuditLogDoc>;
export const AuditLog: Model<AuditLogDoc> = model<AuditLogDoc>('AuditLog', auditLogSchema);
