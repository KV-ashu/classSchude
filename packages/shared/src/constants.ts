/**
 * Global constants shared across apps. Keep this module free of runtime
 * dependencies - it may be imported by server, web and (later) adapters.
 */

/**
 * Confidence policy for the change pipeline:
 *
 * - score >= AUTO_APPLY             -> change is applied automatically
 * - REVIEW <= score < AUTO_APPLY    -> change is queued for human review
 * - score < REVIEW                  -> change is rejected (kept for audit only)
 */
export const CONFIDENCE_THRESHOLDS = {
  AUTO_APPLY: 0.9,
  REVIEW: 0.7,
} as const;

/** Default user timezone. Relative dates are resolved in this zone. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
