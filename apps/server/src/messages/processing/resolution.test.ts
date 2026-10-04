import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  isoWeekdayOf,
  messageLocalDate,
  resolveOccurrenceDate,
  resolveTimeExpression,
} from './resolution';

// 2026-03-10 is a Tuesday. 04:30Z is 10:00 IST the same day.
const MESSAGE_TIMESTAMP = new Date('2026-03-10T04:30:00.000Z');
const IST = 'Asia/Kolkata';
const context = { messageTimestamp: MESSAGE_TIMESTAMP, timezone: IST };

describe('date resolution anchored on the MESSAGE timestamp', () => {
  it('resolves "today" to the date the message was sent', () => {
    expect(messageLocalDate(context)).toBe('2026-03-10');
    expect(resolveOccurrenceDate('today', context)).toBe('2026-03-10');
    expect(resolveOccurrenceDate('aaj', context)).toBe('2026-03-10');
  });

  it('resolves tomorrow / kal and day-after-tomorrow / parso', () => {
    expect(resolveOccurrenceDate('tomorrow', context)).toBe('2026-03-11');
    expect(resolveOccurrenceDate('kal', context)).toBe('2026-03-11');
    expect(resolveOccurrenceDate('day after tomorrow', context)).toBe('2026-03-12');
    expect(resolveOccurrenceDate('parso', context)).toBe('2026-03-12');
  });

  it('never uses the server clock (message sent yesterday)', () => {
    const yesterday = { messageTimestamp: new Date('2026-03-09T04:30:00.000Z'), timezone: IST };

    expect(resolveOccurrenceDate('today', yesterday)).toBe('2026-03-09');
    expect(resolveOccurrenceDate('tomorrow', yesterday)).toBe('2026-03-10');
  });

  it('respects the user timezone across the date boundary', () => {
    // 20:00Z on 2026-03-10 is already 01:30 on 2026-03-11 in IST.
    const lateEvening = { messageTimestamp: new Date('2026-03-10T20:00:00.000Z'), timezone: IST };

    expect(messageLocalDate(lateEvening)).toBe('2026-03-11');
    expect(resolveOccurrenceDate('today', lateEvening)).toBe('2026-03-11');
    expect(messageLocalDate({ ...lateEvening, timezone: 'UTC' })).toBe('2026-03-10');
  });

  it('maps weekday names to the next occurrence', () => {
    expect(resolveOccurrenceDate('Thursday', context)).toBe('2026-03-12');
    expect(resolveOccurrenceDate('tue', context)).toBe('2026-03-10');
  });

  it('accepts explicit dates and returns null for anything unknown', () => {
    expect(resolveOccurrenceDate('2026-04-01', context)).toBe('2026-04-01');
    expect(resolveOccurrenceDate('01/04/2026', context)).toBe('2026-04-01');
    expect(resolveOccurrenceDate(null, context)).toBeNull();
    expect(resolveOccurrenceDate('sometime next week maybe', context)).toBeNull();
  });

  it('exposes the ISO weekday of a resolved date', () => {
    expect(isoWeekdayOf('2026-03-10')).toBe(2);
    expect(isoWeekdayOf('not-a-date')).toBeNull();
  });
});

describe('time expression resolution', () => {
  it('parses 12-hour and 24-hour times', () => {
    expect(resolveTimeExpression('2 PM')?.startTime).toBe('14:00');
    expect(resolveTimeExpression('9:30')?.startTime).toBe('09:30');
    expect(resolveTimeExpression('4 pm sharp')?.startTime).toBe('16:00');
    expect(resolveTimeExpression('12 pm')?.startTime).toBe('12:00');
  });

  it('parses explicit ranges', () => {
    const numeric = resolveTimeExpression('11:00-12:00');
    expect(numeric?.startTime).toBe('11:00');
    expect(numeric?.endTime).toBe('12:00');

    const words = resolveTimeExpression('10 am to 12 pm');
    expect(words?.startTime).toBe('10:00');
    expect(words?.endTime).toBe('12:00');
  });

  it('treats the second time of a replacement as the old start, not an end', () => {
    const replacement = resolveTimeExpression('11 instead of 9');

    expect(replacement?.startTime).toBe('11:00');
    expect(replacement?.endTime).toBeUndefined();
    expect(replacement?.isReplacement).toBe(true);
    expect(replacement?.mentioned).toEqual(['11:00', '09:00']);
  });

  it('ignores numbers that are not times', () => {
    expect(resolveTimeExpression('cancelled for the 3rd time')).toBeNull();
    expect(resolveTimeExpression(null)).toBeNull();
  });

  it('adds minutes to a time, wrapping at midnight', () => {
    expect(addMinutes('11:00', 50)).toBe('11:50');
    expect(addMinutes('23:40', 50)).toBe('00:30');
  });
});