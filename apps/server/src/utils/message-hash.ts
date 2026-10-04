import { createHash } from 'node:crypto';
import type { MessageEvent } from '@classsync/shared';

/**
 * Content hash used to deduplicate identical messages.
 *
 * The user id keeps two accounts that receive the same text apart, `sourceId`
 * keeps adapters apart, and the external id (or sender), timestamp and text
 * identify the exact delivery. Fields are joined with NUL so no value can forge
 * a different combination.
 */
export function computeMessageHash(userId: string, event: MessageEvent): string {
  const parts = [
    userId,
    event.sourceId,
    event.externalId ?? event.senderName ?? '',
    event.timestamp.toISOString(),
    event.rawText.trim(),
  ];

  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}