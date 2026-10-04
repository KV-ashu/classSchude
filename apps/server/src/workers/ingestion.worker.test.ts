import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { RawMessage } from '../models/index';
import { updateRawMessageStatus } from '../repositories/raw-message.repository';
import { ingestMessage } from '../messages/ingestion.service';
import { failStrandedMessage } from '../messages/processing/processor';
import { useTestDatabase } from '../test-utils/db';
import { buildTestEvent, seedTimetableAccount } from '../test-utils/seed';
import { drainProcessingQueue } from './ingestion.worker';
import {
  clearProcessingQueue,
  enqueueMessageForProcessing,
  pendingMessageCount,
} from './processing-queue';

useTestDatabase('classsync_test_worker');

describe('ingestion background worker', () => {
  it('drains queued messages through the pipeline', async () => {
    clearProcessingQueue();
    const account = await seedTimetableAccount();
    const { userId, event } = buildTestEvent(account.userId, 'DBMS class cancelled today');
    const { message } = await ingestMessage(new Types.ObjectId(userId), event);

    enqueueMessageForProcessing(message.id);
    expect(pendingMessageCount()).toBe(1);

    const processed = await drainProcessingQueue();

    expect(processed).toBe(1);
    expect(pendingMessageCount()).toBe(0);

    const updated = await RawMessage.findById(message.id);
    // The stub provider extracts no changes, so the message settles as REJECTED.
    // What matters is that the worker moved it out of RECEIVED and ran the LLM stage.
    expect(updated?.status).not.toBe('RECEIVED');
    expect(updated?.llmMeta?.provider).toBe('stub');
  });

  it('is a no-op when the queue is empty', async () => {
    clearProcessingQueue();

    expect(await drainProcessingQueue()).toBe(0);
  });

  it('never strands a message in RECEIVED or PROCESSING when it fails', async () => {
    clearProcessingQueue();
    const account = await seedTimetableAccount();
    const { userId, event } = buildTestEvent(account.userId, 'DBMS class cancelled today');
    const { message } = await ingestMessage(new Types.ObjectId(userId), event);
    await updateRawMessageStatus(message.id, 'PROCESSING');

    const recorded = await failStrandedMessage(message.id, 'provider exploded');

    expect(recorded).toBe(true);
    const updated = await RawMessage.findById(message.id);
    expect(updated?.status).toBe('FAILED');
    expect(updated?.processingErrors).toContain('provider exploded');
  });

  it('does not overwrite a message that already reached a final status', async () => {
    const account = await seedTimetableAccount();
    const { userId, event } = buildTestEvent(account.userId, 'DBMS lecture shifted to 2 PM today');
    const { message } = await ingestMessage(new Types.ObjectId(userId), event);
    await updateRawMessageStatus(message.id, 'APPLIED');

    expect(await failStrandedMessage(message.id, 'too late')).toBe(false);
    expect((await RawMessage.findById(message.id))?.status).toBe('APPLIED');
  });
});