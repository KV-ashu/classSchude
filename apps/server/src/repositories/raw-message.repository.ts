import type { MessageSourceKind, PipelineStatus } from '@classsync/shared';
import type { Types } from 'mongoose';
import { RawMessage, type LlmMeta, type RawMessageDocument } from '../models/index';
import { isDuplicateKeyError } from '../utils/mongo-errors';

export interface InsertRawMessageInput {
  userId: Types.ObjectId;
  sourceId: string;
  sourceKind: MessageSourceKind;
  externalId?: string;
  senderName?: string;
  groupName?: string;
  timestamp: Date;
  rawText: string;
  hash: string;
}

export interface InsertRawMessageResult {
  message: RawMessageDocument;
  /** false when the hash already existed (duplicate delivery - ignored). */
  created: boolean;
}

/**
 * Inserts a raw message, deduplicating on the unique hash. A duplicate is not
 * an error: the existing document is returned with created=false.
 */
export async function insertRawMessage(
  input: InsertRawMessageInput,
): Promise<InsertRawMessageResult> {
  const existing = await RawMessage.findOne({ hash: input.hash });
  if (existing) {
    return { message: existing, created: false };
  }

  try {
    const message = await RawMessage.create(input);
    return { message, created: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // Lost a race with a concurrent insert of the same message.
      const raced = await RawMessage.findOne({ hash: input.hash });
      if (raced) {
        return { message: raced, created: false };
      }
    }
    throw error;
  }
}

export async function findRawMessageByHash(hash: string): Promise<RawMessageDocument | null> {
  return RawMessage.findOne({ hash });
}

export async function updateRawMessageStatus(
  messageId: string,
  status: PipelineStatus,
  processingErrors: string[] = [],
): Promise<RawMessageDocument | null> {
  return RawMessage.findByIdAndUpdate(
    messageId,
    { $set: { status, processingErrors } },
    { returnDocument: 'after' },
  );
}

export async function listRecentRawMessages(
  userId: Types.ObjectId,
  limit = 50,
): Promise<RawMessageDocument[]> {
  return RawMessage.find({ userId }).sort({ timestamp: -1 }).limit(limit);
}

/** Stores LLM call metadata on the message for observability. */
export async function setRawMessageLlmMeta(
  messageId: string,
  llmMeta: LlmMeta,
): Promise<RawMessageDocument | null> {
  return RawMessage.findByIdAndUpdate(messageId, { $set: { llmMeta } }, { returnDocument: 'after' });
}
