import { describe, expect, it } from 'vitest';
import { messageEventSchema } from './message-event';

const validEvent = {
  sourceId: 'sim:whatsapp-group',
  sourceKind: 'simulator',
  timestamp: new Date('2026-03-10T09:15:00+05:30'),
  rawText: 'kal DBMS cancel hai',
  senderName: 'Rahul',
  groupName: 'CSE-3A',
} as const;

describe('messageEventSchema', () => {
  it('accepts a well-formed message event', () => {
    expect(messageEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it('rejects an empty rawText', () => {
    expect(messageEventSchema.safeParse({ ...validEvent, rawText: '' }).success).toBe(false);
  });

  it('rejects an unknown source kind', () => {
    expect(messageEventSchema.safeParse({ ...validEvent, sourceKind: 'telegram' }).success).toBe(
      false,
    );
  });

  it('rejects string timestamps (must be Date instances at the contract boundary)', () => {
    expect(
      messageEventSchema.safeParse({ ...validEvent, timestamp: '2026-03-10T09:15:00+05:30' }).success,
    ).toBe(false);
  });
});
