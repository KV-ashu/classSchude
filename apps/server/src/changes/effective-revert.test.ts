import { describe, expect, it } from 'vitest';
import { StubProvider } from '../llm/stub.provider';
import { AuditLog, ScheduleChange } from '../models/index';
import { apiClient } from '../test-utils/api';
import { useTestDatabase } from '../test-utils/db';
import { app, buildTestEvent, seedTimetableAccount } from '../test-utils/seed';
import { ingestMessage } from '../messages/ingestion.service';
import { processRawMessage } from '../messages/processing/processor';

useTestDatabase('classsync_test_effective');

const EFFECTIVE_DATE = '2026-03-10'; // Tuesday of the fixture baseline

interface EffectiveBody {
  data: {
    entries: {
      courseCode: string | null;
      startTime: string;
      endTime: string;
      room: string | null;
      status: string;
      changed: boolean;
    }[];
  };
}
interface ChangeBody {
  data: { id: string; status: string };
}

function entryFor(body: EffectiveBody, courseCode: string) {
  return body.data.entries.find((entry) => entry.courseCode === courseCode);
}

async function applyReschedule() {
  const account = await seedTimetableAccount();
  const { userId, event } = buildTestEvent(
    account.userId,
    'DBMS lecture shifted to 2 PM today',
  );
  const { message } = await ingestMessage(userId, event);

  const result = await processRawMessage(message.id, {
    provider: new StubProvider({
      changes: [
        {
          action: 'RESCHEDULE_TIME',
          courseText: 'DBMS',
          dateExpression: 'today',
          timeExpression: '2 PM',
          isAmbiguous: false,
          certainty: 0.97,
          reason: 'explicit shift',
        },
      ],
    }),
  });

  const applied = result.changes[0];
  if (!applied?.changeId) {
    throw new Error('expected the reschedule to be applied');
  }
  return { account, changeId: applied.changeId };
}

describe('effective timetable', () => {
  it('requires authentication', async () => {
    expect((await apiClient(app).get(`/api/changes/effective?date=${EFFECTIVE_DATE}`)).status).toBe(401);
  });

  it('mirrors the immutable baseline while nothing is applied', async () => {
    const account = await seedTimetableAccount();

    const res = await apiClient(app, account.token).get(
      `/api/changes/effective?date=${EFFECTIVE_DATE}`,
    );

    expect(res.status).toBe(200);
    const body = res.body as EffectiveBody;
    const dbms = entryFor(body, 'DBMS');
    expect(dbms?.startTime).toBe('11:00');
    expect(dbms?.endTime).toBe('11:50');
    expect(dbms?.room).toBe('A-101');
    expect(dbms?.status).toBe('SCHEDULED');
    expect(dbms?.changed).toBe(false);
  });

  it('reflects an applied change without touching the baseline', async () => {
    const { account } = await applyReschedule();

    const res = await apiClient(app, account.token).get(
      `/api/changes/effective?date=${EFFECTIVE_DATE}`,
    );
    const dbms = entryFor(res.body as EffectiveBody, 'DBMS');

    expect(dbms?.startTime).toBe('14:00');
    expect(dbms?.endTime).toBe('14:50');
    expect(dbms?.changed).toBe(true);

    const baseline = await apiClient(app, account.token).get('/api/timetable/entries');
    const entries = (baseline.body as { data: { entries: { startTime: string }[] } }).data.entries;
    expect(entries.some((entry) => entry.startTime === '11:00')).toBe(true);
    expect(entries.some((entry) => entry.startTime === '14:00')).toBe(false);
  });
});

describe('revert', () => {
  it('restores the effective schedule and keeps the audit history', async () => {
    const { account, changeId } = await applyReschedule();
    const client = apiClient(app, account.token);

    const reverted = await client.post(`/api/changes/${changeId}/revert`).send({});
    expect(reverted.status).toBe(200);
    expect((reverted.body as ChangeBody).data.status).toBe('REVERTED');

    const restored = (await client.get(
      `/api/changes/effective?date=${EFFECTIVE_DATE}`,
    )).body as EffectiveBody;
    const dbms = entryFor(restored, 'DBMS');
    expect(dbms?.startTime).toBe('11:00');
    expect(dbms?.endTime).toBe('11:50');
    expect(dbms?.changed).toBe(false);

    // History is append-only: the change document survives and both events are audited.
    expect(await ScheduleChange.countDocuments({ status: 'REVERTED' })).toBe(1);
    const actions = (
      await AuditLog.find({ userId: account.userId }).sort({ createdAt: 1 })
    ).map((entry) => entry.action);
    expect(actions).toContain('CHANGE_APPLIED');
    expect(actions).toContain('CHANGE_REVERTED');

    // Reverting twice is refused.
    expect((await client.post(`/api/changes/${changeId}/revert`).send({})).status).toBe(409);
  });

  it('refuses to revert a change that was never applied and hides foreign changes', async () => {
    const { account, changeId } = await applyReschedule();
    const stranger = await seedTimetableAccount();

    expect(
      (await apiClient(app, stranger.token).post(`/api/changes/${changeId}/revert`).send({})).status,
    ).toBe(404);
    expect(
      (await apiClient(app, account.token).post(`/api/changes/${changeId}/revert`).send({})).status,
    ).toBe(200);
  });
});