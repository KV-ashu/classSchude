import { describe, expect, it } from 'vitest';
import { StubProvider } from '../llm/stub.provider';
import { AuditLog, ScheduleChange } from '../models/index';
import { apiClient } from '../test-utils/api';
import { useTestDatabase } from '../test-utils/db';
import { app, buildTestEvent, seedTimetableAccount } from '../test-utils/seed';
import { ingestMessage } from '../messages/ingestion.service';
import { processRawMessage } from '../messages/processing/processor';

useTestDatabase('classsync_test_review');

const EFFECTIVE_DATE = '2026-03-10';

interface ListBody {
  data: { id: string; status: string; confidence: number }[];
}
interface ChangeBody {
  data: { id: string; status: string; newValue: { room?: string } | null };
}
interface EffectiveBody {
  data: { entries: { courseCode: string | null; status: string; room: string | null }[] };
}

/** Ingests a hedged message so the pipeline queues it for review. */
async function queueChange() {
  const account = await seedTimetableAccount();
  const { userId, event } = buildTestEvent(account.userId, 'I think DBMS is cancelled');
  const { message } = await ingestMessage(userId, event);

  const result = await processRawMessage(message.id, {
    provider: new StubProvider({
      changes: [
        {
          action: 'CANCEL',
          courseText: 'DBMS',
          dateExpression: 'today',
          isAmbiguous: true,
          certainty: 0.9,
          reason: 'hedged statement',
        },
      ],
    }),
  });

  if (result.status !== 'QUEUED') {
    throw new Error(`expected QUEUED, got ${result.status}`);
  }
  return account;
}

describe('review queue', () => {
  it('requires authentication', async () => {
    expect((await apiClient(app).get('/api/changes')).status).toBe(401);
    expect((await apiClient(app).post('/api/changes/000000000000000000000000/approve').send({})).status).toBe(401);
  });

  it('lists pending changes and applies one on approval', async () => {
    const account = await queueChange();
    const client = apiClient(app, account.token);

    const pending = await client.get('/api/changes?status=PENDING_REVIEW');
    expect(pending.status).toBe(200);
    const [queued] = (pending.body as ListBody).data;
    expect(queued?.status).toBe('PENDING_REVIEW');

    const approved = await client.post(`/api/changes/${queued?.id}/approve`).send({ room: 'C-301' });
    expect(approved.status).toBe(200);
    expect((approved.body as ChangeBody).data.status).toBe('APPLIED_MANUALLY');

    const effective = (await client.get(
      `/api/changes/effective?date=${EFFECTIVE_DATE}`,
    )).body as EffectiveBody;
    const dbms = effective.data.entries.find((entry) => entry.courseCode === 'DBMS');
    expect(dbms?.status).toBe('CANCELLED');

    expect(await AuditLog.countDocuments({ action: 'CHANGE_APPLIED', actor: 'USER' })).toBe(1);
    // Already decided - a second decision is refused.
    expect((await client.post(`/api/changes/${queued?.id}/reject`).send({})).status).toBe(409);
  });

  it('discards a queued change on rejection and leaves the baseline intact', async () => {
    const account = await queueChange();
    const client = apiClient(app, account.token);
    const pending = (await client.get('/api/changes?status=PENDING_REVIEW')).body as ListBody;
    const [queued] = pending.data;

    const rejected = await client
      .post(`/api/changes/${queued?.id}/reject`)
      .send({ reason: 'looks unrelated' });
    expect(rejected.status).toBe(200);
    expect((rejected.body as ChangeBody).data.status).toBe('REJECTED');

    const effective = (await client.get(
      `/api/changes/effective?date=${EFFECTIVE_DATE}`,
    )).body as EffectiveBody;
    const dbms = effective.data.entries.find((entry) => entry.courseCode === 'DBMS');
    expect(dbms?.status).toBe('SCHEDULED');
    expect(dbms?.room).toBe('A-101');

    expect(await AuditLog.countDocuments({ action: 'CHANGE_REJECTED' })).toBe(1);
    expect(await ScheduleChange.countDocuments({ status: 'REJECTED' })).toBe(1);
  });

  it('hides another account changes', async () => {
    const owner = await queueChange();
    const stranger = await seedTimetableAccount();

    const res = await apiClient(app, stranger.token).get('/api/changes');

    expect((res.body as ListBody).data).toHaveLength(0);
    expect((await apiClient(app, owner.token).get('/api/changes')).status).toBe(200);
  });
});