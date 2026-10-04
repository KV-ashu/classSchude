import { messageEventSchema, type MessageEvent } from '@classsync/shared';
import type { Types } from 'mongoose';
import type { RawMessageDocument } from '../models/index';
import {
  insertRawMessage,
  updateRawMessageStatus,
} from '../repositories/raw-message.repository';
import { computeMessageHash } from '../utils/message-hash';

export interface IngestResult {
  message: RawMessageDocument;
  /** false when the very same message was already ingested (deduplicated). */
  created: boolean;
  hash: string;
}

/**
 * Ingests one normalized event:
 * contract validation -> content hash -> deduplication -> RawMessage (RECEIVED).
 *
 * Nothing is interpreted here yet: extraction and timetable logic arrive in
 * Phase 5, which drains the adapter queue and calls markMessageProcessing.
 */
export async function ingestMessage(
  userId: Types.ObjectId,
  event: MessageEvent,
): Promise<IngestResult> {
  const validated = messageEventSchema.parse(event);
  const hash = computeMessageHash(userId.toString(), validated);

  const { message, created } = await insertRawMessage({
    userId,
    sourceId: validated.sourceId,
    sourceKind: validated.sourceKind,
    externalId: validated.externalId,
    senderName: validated.senderName,
    groupName: validated.groupName,
    timestamp: validated.timestamp,
    rawText: validated.rawText,
    hash,
  });

  return { message, created, hash };
}

/** Moves a stored message into PROCESSING (called by the Phase 5 pipeline). */
export async function markMessageProcessing(
  messageId: string,
): Promise<RawMessageDocument | null> {
  return updateRawMessageStatus(messageId, 'PROCESSING');
}