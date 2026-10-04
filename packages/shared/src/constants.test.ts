import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLDS, DEFAULT_TIMEZONE } from './constants';

describe('CONFIDENCE_THRESHOLDS', () => {
  it('keeps auto-apply strictly above the review threshold', () => {
    expect(CONFIDENCE_THRESHOLDS.AUTO_APPLY).toBeGreaterThan(CONFIDENCE_THRESHOLDS.REVIEW);
  });

  it('stays inside the 0..1 score range', () => {
    expect(CONFIDENCE_THRESHOLDS.AUTO_APPLY).toBeLessThanOrEqual(1);
    expect(CONFIDENCE_THRESHOLDS.REVIEW).toBeGreaterThanOrEqual(0);
  });
});

describe('DEFAULT_TIMEZONE', () => {
  it('is a valid IANA timezone name', () => {
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIMEZONE })).not.toThrow();
  });
});
