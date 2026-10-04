import { SCHEDULE_CHANGE_ACTIONS } from '@classsync/shared';
import { z } from 'zod';

/**
 * Strict contract for what the LLM may return.
 *
 * Every optional value is `nullable` on purpose: the model never computes dates
 * or invents times. It only echoes the phrases it read, and the deterministic
 * resolver turns them into concrete values (or leaves them null).
 */
export const extractedChangeSchema = z.object({
  action: z.enum([...SCHEDULE_CHANGE_ACTIONS]),
  /** Course exactly as written in the message ("DBMS", "DBS", "dbms"). */
  courseText: z.string().trim().min(1).max(80).nullable().default(null),
  /** Raw date phrase ("today", "kal", "tomorrow"). Never a computed date. */
  dateExpression: z.string().trim().min(1).max(60).nullable().default(null),
  /** Raw time phrase ("2 PM", "11:00-12:00", "11 instead of 9"). */
  timeExpression: z.string().trim().min(1).max(60).nullable().default(null),
  room: z.string().trim().min(1).max(40).nullable().default(null),
  /** Hedged wording ("I think ...", "maybe", "probably"). */
  isAmbiguous: z.boolean().default(false),
  /** The model's own certainty, 0..1. */
  certainty: z.number().min(0).max(1),
  /** Short justification shown in the review UI. */
  reason: z.string().trim().min(1).max(200).nullable().default(null),
});

export const extractionResultSchema = z.object({
  changes: z.array(extractedChangeSchema).max(10),
});

export type ExtractedChange = z.infer<typeof extractedChangeSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** Raised when the model output cannot be repaired into the contract. */
export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}