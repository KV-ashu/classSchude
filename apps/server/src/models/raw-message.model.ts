import {
  MESSAGE_SOURCE_KINDS,
  PIPELINE_STATUSES,
  type MessageSourceKind,
  type PipelineStatus,
} from '@classsync/shared';
import { model, Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

/** LLM call metadata captured for observability of the extraction stage. */
export interface LlmMeta {
  provider?: string;
  model?: string;
  latencyMs?: number;
  promptVersion?: string;
  repairAttempted?: boolean;
}

/** sha256 hex digest length. */
export const RAW_MESSAGE_HASH_LENGTH = 64;

export interface RawMessageDoc {
  userId: Types.ObjectId;
  sourceId: string;
  sourceKind: MessageSourceKind;
  externalId?: string;
  senderName?: string;
  groupName?: string;
  /** When the message was sent - relative dates resolve against THIS, never Date.now(). */
  timestamp: Date;
  rawText: string;
  /** sha256 dedup hash of source + sender + timestamp + text; unique per message. */
  hash: string;
  status: PipelineStatus;
  processingErrors: string[];
  llmMeta?: LlmMeta;
  createdAt: Date;
  updatedAt: Date;
}

const llmMetaSchema = new Schema<LlmMeta>(
  {
    provider: { type: String, trim: true },
    model: { type: String, trim: true },
    latencyMs: { type: Number, min: 0 },
    promptVersion: { type: String, trim: true },
    repairAttempted: { type: Boolean },
  },
  { _id: false },
);

const rawMessageSchema = new Schema<RawMessageDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sourceId: { type: String, required: true, trim: true, maxlength: 120 },
    sourceKind: { type: String, enum: [...MESSAGE_SOURCE_KINDS], required: true },
    externalId: { type: String, trim: true, maxlength: 200 },
    senderName: { type: String, trim: true, maxlength: 80 },
    groupName: { type: String, trim: true, maxlength: 120 },
    timestamp: { type: Date, required: true },
    rawText: { type: String, required: true, maxlength: 5000 },
    hash: { type: String, required: true, length: RAW_MESSAGE_HASH_LENGTH, lowercase: true },
    status: { type: String, enum: [...PIPELINE_STATUSES], required: true, default: 'RECEIVED' },
    processingErrors: { type: [String], default: [] },
    llmMeta: { type: llmMetaSchema },
  },
  { timestamps: true },
);

// Deduplication: the same physical message can never be ingested twice.
rawMessageSchema.index({ hash: 1 }, { unique: true });
rawMessageSchema.index({ userId: 1, timestamp: -1 });
rawMessageSchema.index({ status: 1 });

export type RawMessageDocument = HydratedDocument<RawMessageDoc>;
export const RawMessage: Model<RawMessageDoc> = model<RawMessageDoc>('RawMessage', rawMessageSchema);
