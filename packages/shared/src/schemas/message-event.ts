import { z } from 'zod';
import { messageSourceKindSchema } from '../enums';

/**
 * Canonical, source-agnostic message event.
 *
 * Every MessageSourceAdapter normalizes its input into this shape and the
 * processing pipeline only ever consumes MessageEvent - it must never know
 * (or care) whether a message came from manual input, a simulator, or a
 * future Android notification scraper.
 */
export const messageEventSchema = z.object({
  /** Identifier of the adapter instance (e.g. "manual:default", "sim:whatsapp-group"). */
  sourceId: z.string().min(1),
  sourceKind: messageSourceKindSchema,
  /** Id from the origin system when available; feeds deduplication together with the hash. */
  externalId: z.string().min(1).optional(),
  /**
   * When the message was sent. Relative dates ("tomorrow", "kal") MUST be
   * resolved against this value, never against the server's current time.
   */
  timestamp: z.date(),
  /** Original text, preserved verbatim for the audit trail. */
  rawText: z.string().min(1),
  senderName: z.string().min(1).optional(),
  groupName: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type MessageEvent = z.infer<typeof messageEventSchema>;
