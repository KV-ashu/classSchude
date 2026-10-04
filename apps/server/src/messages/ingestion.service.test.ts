import type { MessageEvent } from '@classsync/shared';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { RawMessage } from '../models/index';
import { useTestDatabase } from '../test-utils/db';
import { computeMessageHash } from '../utils/message-hash';
import { ingestMessage, markMessageProcessing } from './ingestion.service';

useTestDatabase('classsync_test_ingestion');

function buildEvent(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    sourceId: 'manual:rest',
    sourceKind: 'manual',
    externalId: 'ext-1',
    timestamp: new Date('2026-03-10T09:15:00.000Z'),
    rawText: 'DBMS class cancelled today',
    senderName: 'Rahul',
    groupName: 'CSE-3A Official',
    ...overrides,
  };
}

describe('computeMessageHash', () => {
  const userId = new Types.ObjectId().toString();

  it('is stable for the same event and changes with the text', () => {
    const hash = computeMessageHash(userId, buildEvent());

    expect(hash).toBe(computeMessageHash(userId, buildEvent()));
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(
      computeMessageHash(userId, buildEvent({ rawText: 'DBMS class not cancelled' })),
    );
  });

  it('separates sources, timestamps and users', () => {
    const hash = computeMessageHash(userId, buildEvent());

    expect(hash).not.toBe(
      computeMessageHash(userId, buildEvent({ sourceId: 'sim:whatsapp-cse3a' })),
    );
    expect(hash).not.toBe(
      computeMessageHash(userId, buildEvent({ timestamp: new Date('2026-03-10T09:16:00.000Z') })),
    );
    expect(hash).not.toBe(computeMessageHash(new Types.ObjectId().toString(), buildEvent()));
  });
});

describe('ingestMessage', () => {
  it('stores the message as RECEIVED and reports created=true', async () => {
    const result = await ingestMessage(new Types.ObjectId(), buildEvent());

    expect(result.created).toBe(true);
    expect(result.message.status).toBe('RECEIVED');
    expect(result.message.sourceKind).toBe('manual');
    expect(result.message.rawText).toBe('DBMS class cancelled today');
    expect(result.message.senderName).toBe('Rahul');
    expect(result.message.groupName).toBe('CSE-3A Official');
    expect(result.message.timestamp.toISOString()).toBe('2026-03-10T09:15:00.000Z');
    expect(await RawMessage.countDocuments()).toBe(1);
  });

  it('deduplicates an identical delivery instead of storing it twice', async () => {
    const userId = new Types.ObjectId();

    const first = await ingestMessage(userId, buildEvent());
    const second = await ingestMessage(userId, buildEvent());

    expect(second.created).toBe(false);
    expect(second.hash).toBe(first.hash);
    expect(second.message.id).toBe(first.message.id);
    expect(await RawMessage.countDocuments()).toBe(1);
  });

  it('keeps the same text from different users apart', async () => {
    await ingestMessage(new Types.ObjectId(), buildEvent());
    await ingestMessage(new Types.ObjectId(), buildEvent());

    expect(await RawMessage.countDocuments()).toBe(2);
  });

  it('refuses an event that violates the MessageEvent contract', async () => {
    const invalid = { ...buildEvent(), rawText: '' };

    await expect(
      ingestMessage(new Types.ObjectId(), invalid as unknown as MessageEvent),
    ).rejects.toThrow();
    expect(await RawMessage.countDocuments()).toBe(0);
  });

  it('moves a message into PROCESSING for the pipeline', async () => {
    const result = await ingestMessage(new Types.ObjectId(), buildEvent());

    const updated = await markMessageProcessing(result.message.id);

    expect(updated?.status).toBe('PROCESSING');
  });
});