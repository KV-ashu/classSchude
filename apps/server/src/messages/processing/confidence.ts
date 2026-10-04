import { CONFIDENCE_THRESHOLDS } from '@classsync/shared';

export interface ConfidenceInput {
  /** Certainty reported by the model (0..1). */
  certainty: number;
  /** Strength of the course match (1 = exact, lower = fuzzy). */
  courseMatchScore: number;
  /** Character edits behind a fuzzy course match (0 = exact, 1 = typo). */
  courseMatchEdits?: number;
  /** A single baseline entry was identified for this course/date. */
  targetResolved: boolean;
  /** The message hedges ("I think ...", contradictory follow-up). */
  isAmbiguous: boolean;
  /** The proposed change overlaps another class. */
  hasConflict: boolean;
  /** No date phrase in the message - occurrence date could not be derived from words. */
  missingOccurrenceDate: boolean;
  /** A field the action needs (room/time) was absent. */
  missingRequiredField: boolean;
}

export interface ConfidenceFactors {
  certainty: number;
  courseMatch: number;
  targetResolved: boolean;
  ambiguityPenalty: number;
  conflictPenalty: number;
  missingDatePenalty: number;
  missingFieldPenalty: number;
  weakMatchPenalty: number;
}

export interface ConfidenceScore {
  score: number;
  factors: ConfidenceFactors;
}

const WEIGHT_CERTAINTY = 0.45;
const WEIGHT_COURSE_MATCH = 0.3;
const WEIGHT_TARGET = 0.15;
const BASE_COMPLETENESS = 0.1;

const AMBIGUITY_PENALTY = 0.25;
const CONFLICT_PENALTY = 0.2;
const MISSING_DATE_PENALTY = 0.15;
const MISSING_FIELD_PENALTY = 0.2;
/** A course identity that needed 2+ edits can never auto-apply - we could cancel the wrong class. */
const WEAK_MATCH_EDIT_DISTANCE = 2;
const WEAK_MATCH_PENALTY = 0.15;

export type Decision = 'AUTO_APPLY' | 'REVIEW' | 'REJECT';

/**
 * Deterministic, explainable confidence. The model's certainty is only one
 * input - hedging, conflicts, missing data and weak course matches all pull the
 * score down so ambiguous messages can never auto-apply.
 */
export function scoreConfidence(input: ConfidenceInput): ConfidenceScore {
  const factors: ConfidenceFactors = {
    certainty: clamp01(input.certainty),
    courseMatch: clamp01(input.courseMatchScore),
    targetResolved: input.targetResolved,
    ambiguityPenalty: input.isAmbiguous ? AMBIGUITY_PENALTY : 0,
    conflictPenalty: input.hasConflict ? CONFLICT_PENALTY : 0,
    missingDatePenalty: input.missingOccurrenceDate ? MISSING_DATE_PENALTY : 0,
    missingFieldPenalty: input.missingRequiredField ? MISSING_FIELD_PENALTY : 0,
    weakMatchPenalty:
      (input.courseMatchEdits ?? 0) >= WEAK_MATCH_EDIT_DISTANCE ? WEAK_MATCH_PENALTY : 0,
  };

  const base =
    WEIGHT_CERTAINTY * factors.certainty +
    WEIGHT_COURSE_MATCH * factors.courseMatch +
    WEIGHT_TARGET * (factors.targetResolved ? 1 : 0) +
    BASE_COMPLETENESS;

  const score = clamp01(
    base -
      factors.ambiguityPenalty -
      factors.conflictPenalty -
      factors.missingDatePenalty -
      factors.missingFieldPenalty -
      factors.weakMatchPenalty,
  );

  return { score: Number(score.toFixed(4)), factors };
}

/** Routes a score through the policy thresholds (>=0.90 apply, >=0.70 review). */
export function decide(score: number): Decision {
  if (score >= CONFIDENCE_THRESHOLDS.AUTO_APPLY) {
    return 'AUTO_APPLY';
  }
  if (score >= CONFIDENCE_THRESHOLDS.REVIEW) {
    return 'REVIEW';
  }
  return 'REJECT';
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}