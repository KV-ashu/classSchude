import { describe, expect, it } from 'vitest';
import { decide, scoreConfidence } from './confidence';

const clean = {
  certainty: 0.95,
  courseMatchScore: 1,
  targetResolved: true,
  isAmbiguous: false,
  hasConflict: false,
  missingOccurrenceDate: false,
  missingRequiredField: false,
};

describe('confidence scoring', () => {
  it('auto-applies a clean, certain, fully resolved change', () => {
    const { score, factors } = scoreConfidence(clean);

    expect(score).toBeGreaterThanOrEqual(0.9);
    expect(decide(score)).toBe('AUTO_APPLY');
    expect(factors.ambiguityPenalty).toBe(0);
  });

  it('queues hedged messages for review even when the model sounds sure', () => {
    const { score } = scoreConfidence({ ...clean, certainty: 0.9, isAmbiguous: true });

    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(score).toBeLessThan(0.9);
    expect(decide(score)).toBe('REVIEW');
  });

  it('never auto-applies a change that overlaps another class', () => {
    const { score } = scoreConfidence({ ...clean, hasConflict: true });

    expect(score).toBeLessThan(0.9);
    expect(decide(score)).toBe('REVIEW');
  });

  it('never auto-applies a change without a stated date', () => {
    const { score } = scoreConfidence({ ...clean, missingOccurrenceDate: true });

    expect(decide(score)).toBe('REVIEW');
  });

  it('penalizes a weak course match and an unresolved target', () => {
    // Two or more edits behind a course identity is never auto-applied...
    expect(decide(scoreConfidence({ ...clean, courseMatchEdits: 2 }).score)).toBe('REVIEW');
    // ...while a single-character typo still can be.
    expect(decide(scoreConfidence({ ...clean, courseMatchEdits: 1 }).score)).toBe('AUTO_APPLY');
    expect(decide(scoreConfidence({ ...clean, targetResolved: false }).score)).toBe('REVIEW');
  });

  it('rejects low certainty outright', () => {
    const { score } = scoreConfidence({ ...clean, certainty: 0.25 });

    expect(decide(score)).toBe('REJECT');
  });

  it('clamps the score into 0..1', () => {
    expect(scoreConfidence({ ...clean, certainty: 5 }).score).toBeLessThanOrEqual(1);
    expect(scoreConfidence({ ...clean, certainty: -3 }).score).toBeGreaterThanOrEqual(0);
  });

  it('routes exactly at the documented thresholds', () => {
    expect(decide(0.9)).toBe('AUTO_APPLY');
    expect(decide(0.8999)).toBe('REVIEW');
    expect(decide(0.7)).toBe('REVIEW');
    expect(decide(0.6999)).toBe('REJECT');
  });
});