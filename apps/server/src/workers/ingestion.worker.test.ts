import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { RawMessage } from '../models/index';
import { ingestMessage } from '../messages/ingestion.service';
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
});