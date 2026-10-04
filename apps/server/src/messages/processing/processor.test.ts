import { describe, expect, it } from 'vitest';
import { StubProvider } from '../../llm/stub.provider';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '../../llm/types';
import { AuditLog, RawMessage, ScheduleChange } from '../../models/index';
import { apiClient, registerTestUser } from '../../test-utils/api';
import { useTestDatabase } from '../../test-utils/db';
import {
  FIXTURE_MESSAGE_TIMESTAMP,
  app,
  buildTestEvent,
  seedTimetableAccount,
} from '../../test-utils/seed';
import { ingestMessage } from '../ingestion.service';
import { processRawMessage } from './processor';

useTestDatabase('classsync_test_processor');

/** Fails the test if the pipeline tries to reach an LLM. */
class ForbiddenProvider implements LlmProvider {
  readonly name = 'forbidden';
  readonly model = 'forbidden';

  async complete(): Promise<never> {
    throw new Error('the LLM must not be called for this message');
  }
}

/** Invalid answer first, valid answer second - exercises the repair pass. */
class RepairingProvider implements LlmProvider {
  readonly name = 'repairing';
  readonly model = 'repairing';
  calls = 0;

  constructor(private readonly validPayload: unknown) {}

  async complete(_request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.calls += 1;
    return {
      json: this.calls === 1 ? { changes: [{ action: 'NOT_AN_ACTION' }] } : this.validPayload,
      model: this.model,
      latencyMs: 1,
    };
  }
}

function change(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'CANCEL',
    courseText: 'DBMS',
    dateExpression: 'today',
    timeExpression: null,
    room: null,
    isAmbiguous: false,
    certainty: 0.97,
    reason: 'explicit cancellation',
    ...overrides,
  };
}

async function run(text: string, payload: unknown, timestamp: Date = FIXTURE_MESSAGE_TIMESTAMP) {
  const account = await seedTimetableAccount();
  const { userId, event } = buildTestEvent(account.userId, text, timestamp);
  const { message } = await ingestMessage(userId, event);
  const result = await processRawMessage(message.id, { provider: new StubProvider(payload) });
  return { account, message, result };
}

describe('auto-apply (>= 0.90)', () => {
  it('applies a clear cancellation, audits it and marks the message APPLIED', async () => {
    const { message, result } = await run('DBMS class cancelled today', {
      changes: [change()],
    });

    expect(result.status).toBe('APPLIED');
    const [outcome] = result.changes;
    expect(outcome?.decision).toBe('AUTO_APPLY');
    expect(outcome?.courseCode).toBe('DBMS');
    expect(outcome?.occurrenceDate).toBe('2026-03-10');

    const stored = await ScheduleChange.findById(outcome?.changeId ?? '');
    expect(stored?.status).toBe('AUTO_APPLIED');
    expect(stored?.action).toBe('CANCEL');
    expect(stored?.confidence).toBeGreaterThanOrEqual(0.9);

    expect(await AuditLog.countDocuments({ action: 'CHANGE_APPLIED' })).toBe(1);

    const reloaded = await RawMessage.findById(message.id);
    expect(reloaded?.status).toBe('APPLIED');
    expect(reloaded?.llmMeta?.provider).toBe('stub');
    expect(reloaded?.llmMeta?.promptVersion).toBe('extract-v1');
  });

  it('resolves a typo to the real course before applying', async () => {
    const { result } = await run('DBS cancel ho raha hai', {
      changes: [change({ courseText: 'DBS' })],
    });

    expect(result.changes[0]?.courseCode).toBe('DBMS');
    expect(result.changes[0]?.decision).toBe('AUTO_APPLY');
  });

  it('resolves relative dates against the MESSAGE timestamp, not the server clock', async () => {
    const { result } = await run(
      'kal DBMS cancel hai',
      { changes: [change({ dateExpression: 'kal' })] },
      new Date('2026-03-09T04:30:00.000Z'),
    );

    expect(result.changes[0]?.occurrenceDate).toBe('2026-03-10');
  });
});

describe('queue for review (0.70 - 0.89)', () => {
  it('queues a hedged cancellation instead of applying it', async () => {
    const { result } = await run('I think DBMS is cancelled', {
      changes: [change({ isAmbiguous: true, certainty: 0.9 })],
    });

    expect(result.status).toBe('QUEUED');
    expect(result.changes[0]?.decision).toBe('REVIEW');
    expect(await ScheduleChange.countDocuments({ status: 'PENDING_REVIEW' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'CHANGE_APPLIED' })).toBe(0);
  });

  it('queues a reschedule that would overlap another class', async () => {
    const { result } = await run('OS class shifted to 11:30', {
      changes: [
        change({ action: 'RESCHEDULE_TIME', courseText: 'OS', timeExpression: '11:30 AM' }),
      ],
    });

    expect(result.status).toBe('QUEUED');
    expect(result.changes[0]?.note).toContain('overlaps');
  });

  it('never invents a date when the message states none', async () => {
    const { result } = await run('DBMS class cancelled', {
      changes: [change({ dateExpression: null })],
    });

    expect(result.changes[0]?.occurrenceDate).toBeNull();
    expect(result.changes[0]?.decision).toBe('REVIEW');
    expect(result.changes[0]?.changeId).toBeNull();
    expect(await ScheduleChange.countDocuments()).toBe(0);
  });
});

describe('rejection (< 0.70)', () => {
  it('rejects a subject that is not in the baseline', async () => {
    // Timetable vocabulary keeps the message relevant; the unknown subject is then rejected.
    const { result } = await run('MATH301 lecture postponed to Monday', {
      changes: [change({ courseText: 'MATH301' })],
    });

    expect(result.status).toBe('REJECTED');
    expect(result.changes[0]?.decision).toBe('REJECT');
    expect(result.changes[0]?.note).toContain('no course');
    expect(await ScheduleChange.countDocuments()).toBe(0);
  });

  it('rejects when the model is not confident', async () => {
    const { result } = await run('DBMS class cancelled today', {
      changes: [change({ certainty: 0.2 })],
    });

    expect(result.changes[0]?.decision).toBe('REJECT');
  });
});

describe('resilience', () => {
  it('never calls the LLM for plain chatter', async () => {
    const account = await seedTimetableAccount();
    const { userId, event } = buildTestEvent(account.userId, 'Does anyone have the DSA notes?');
    const { message } = await ingestMessage(userId, event);

    const result = await processRawMessage(message.id, { provider: new ForbiddenProvider() });

    expect(result.status).toBe('IGNORED');
    expect((await RawMessage.findById(message.id))?.status).toBe('IGNORED');
  });

  it('marks the message FAILED when the model output cannot be repaired', async () => {
    const account = await seedTimetableAccount();
    const { userId, event } = buildTestEvent(account.userId, 'DBMS class cancelled today');
    const { message } = await ingestMessage(userId, event);

    await expect(
      processRawMessage(message.id, {
        provider: new StubProvider({ changes: [{ action: 'NOPE' }] }),
      }),
    ).rejects.toThrow();

    const failed = await RawMessage.findById(message.id);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.processingErrors.length).toBeGreaterThan(0);
    expect(await ScheduleChange.countDocuments()).toBe(0);
  });

  it('repairs a single schema violation and continues', async () => {
    const account = await seedTimetableAccount();
    const { userId, event } = buildTestEvent(account.userId, 'DBMS class cancelled today');
    const { message } = await ingestMessage(userId, event);
    const provider = new RepairingProvider({ changes: [change()] });

    const result = await processRawMessage(message.id, { provider });

    expect(provider.calls).toBe(2);
    expect(result.repaired).toBe(true);
    expect(result.status).toBe('APPLIED');
  });

  it('rejects without calling the LLM when no baseline exists yet', async () => {
    const account = await registerTestUser(app);
    await apiClient(app, account.token)
      .post('/api/courses')
      .send({ name: 'Database Systems', code: 'DBMS' });

    const { userId, event } = buildTestEvent(account.userId, 'DBMS class cancelled today');
    const { message } = await ingestMessage(userId, event);

    const result = await processRawMessage(message.id, { provider: new ForbiddenProvider() });

    expect(result.status).toBe('REJECTED');
  });
});