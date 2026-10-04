import { PIPELINE_STATUSES } from '@classsync/shared';
import { z } from 'zod';

export const manualMessageBodySchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(5000),
  senderName: z.string().trim().max(80).optional(),
  groupName: z.string().trim().max(120).optional(),
  /** ISO-8601 instant with offset; defaults to the server clock. */
  timestamp: z.iso.datetime({ offset: true }).optional(),
  externalId: z.string().trim().max(200).optional(),
});

export const simulateMessageBodySchema = z.object({
  /** `next` replays one scripted message, `all` the rest, `reset` rewinds. */
  mode: z.enum(['next', 'all', 'reset']).default('next'),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum([...PIPELINE_STATUSES]).optional(),
});

export type ManualMessageBody = z.infer<typeof manualMessageBodySchema>;
export type SimulateMessageBody = z.infer<typeof simulateMessageBodySchema>;