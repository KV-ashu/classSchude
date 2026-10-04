import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { RawMessage } from '../models/index';
import { apiClient, registerTestUser } from '../test-utils/api';
import { useTestDatabase } from '../test-utils/db';
import { messageAdapters } from './adapters';
import { clearMessageEventQueue, pendingMessageEventCount } from './pipeline-queue';

useTestDatabase('classsync_test_messages');

const app = createApp();

beforeEach(() => {
  clearMessageEventQueue();
  messageAdapters.simulation.reset();
});

interface MessageDto {
  id: string;
  rawText: string;
  status: string;
  sourceKind: string;
  created: boolean;
}
interface MessageBody {
  data: MessageDto;
}
interface MessageListBody {
  data: MessageDto[];
}
interface SimulateBody {
  data: {
    mode: string;
    ingested: MessageDto[];
    createdCount: number;
    duplicateCount: number;
    remaining: number;
  };
}
interface ScenarioBody {
  data: { total: number; messages: { index: number; text: string }[] };
}

describe('POST /api/messages/manual', () => {
  it('requires authentication', async () => {
    const res = await apiClient(app).post('/api/messages/manual').send({ text: 'DBMS cancelled' });

    expect(res.status).toBe(401);
  });

  it('ingests a message, stores it and queues it for the pipeline', async () => {
    const account = await registerTestUser(app);

    const res = await apiClient(app, account.token)
      .post('/api/messages/manual')
      .send({ text: 'DBMS class cancelled today', senderName: 'Rahul', groupName: 'CSE-3A Official' });

    expect(res.status).toBe(201);
    const data = (res.body as MessageBody).data;
    expect(data.created).toBe(true);
    expect(data.status).toBe('RECEIVED');
    expect(data.sourceKind).toBe('manual');
    expect(await RawMessage.countDocuments()).toBe(1);
    expect(pendingMessageEventCount()).toBe(1);
  });

  it('deduplicates an identical resubmission instead of storing it twice', async () => {
    const account = await registerTestUser(app);
    const client = apiClient(app, account.token);
    const payload = {
      text: 'DBMS class cancelled today',
      senderName: 'Rahul',
      timestamp: '2026-03-10T09:15:00+05:30',
    };

    const first = await client.post('/api/messages/manual').send(payload);
    const second = await client.post('/api/messages/manual').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as MessageBody).data.created).toBe(false);
    expect((second.body as MessageBody).data.id).toBe((first.body as MessageBody).data.id);
    expect(await RawMessage.countDocuments()).toBe(1);
  });

  it('rejects an empty message with 422', async () => {
    const account = await registerTestUser(app);

    const res = await apiClient(app, account.token)
      .post('/api/messages/manual')
      .send({ text: '   ' });

    expect(res.status).toBe(422);
    expect(await RawMessage.countDocuments()).toBe(0);
  });
});

describe('POST /api/messages/simulate', () => {
  it('replays one scripted message per call', async () => {
    const account = await registerTestUser(app);
    const client = apiClient(app, account.token);

    const res = await client.post('/api/messages/simulate').send({ mode: 'next' });

    expect(res.status).toBe(201);
    const body = (res.body as SimulateBody).data;
    expect(body.ingested).toHaveLength(1);
    expect(body.createdCount).toBe(1);
    expect(body.ingested[0]?.sourceKind).toBe('simulator');
    expect(await RawMessage.countDocuments()).toBe(1);
  });

  it('replays the remaining scenario, reports exhaustion and can reset', async () => {
    const account = await registerTestUser(app);
    const client = apiClient(app, account.token);
    const total = messageAdapters.simulation.total;

    await client.post('/api/messages/simulate').send({ mode: 'next' });
    const all = await client.post('/api/messages/simulate').send({ mode: 'all' });

    expect((all.body as SimulateBody).data.ingested).toHaveLength(total - 1);
    expect((all.body as SimulateBody).data.remaining).toBe(0);
    expect(await RawMessage.countDocuments()).toBe(total);

    const exhausted = await client.post('/api/messages/simulate').send({ mode: 'next' });
    expect(exhausted.status).toBe(409);

    const reset = await client.post('/api/messages/simulate').send({ mode: 'reset' });
    expect(reset.status).toBe(200);
    expect((reset.body as SimulateBody).data.remaining).toBe(total);
  });

  it('recognises a replay after reset as the same message (dedup)', async () => {
    const account = await registerTestUser(app);
    const client = apiClient(app, account.token);

    await client.post('/api/messages/simulate').send({ mode: 'next' });
    await client.post('/api/messages/simulate').send({ mode: 'reset' });
    const replay = await client.post('/api/messages/simulate').send({ mode: 'next' });

    expect(replay.status).toBe(201);
    expect((replay.body as SimulateBody).data.duplicateCount).toBe(1);
    expect(await RawMessage.countDocuments()).toBe(1);
  });

  it('exposes the scripted scenario catalog', async () => {
    const account = await registerTestUser(app);

    const res = await apiClient(app, account.token).get('/api/messages/simulate');

    expect(res.status).toBe(200);
    const data = (res.body as ScenarioBody).data;
    expect(data.total).toBeGreaterThanOrEqual(20);
    expect(data.messages[0]?.index).toBe(0);
    expect(data.messages[0]?.text.length).toBeGreaterThan(0);
  });
});

describe('GET /api/messages', () => {
  it('requires authentication', async () => {
    expect((await apiClient(app).get('/api/messages')).status).toBe(401);
  });

  it('returns the ingestion history newest first', async () => {
    const account = await registerTestUser(app);
    const client = apiClient(app, account.token);

    await client
      .post('/api/messages/manual')
      .send({ text: 'first message', timestamp: '2026-03-10T09:00:00+05:30' });
    await client
      .post('/api/messages/manual')
      .send({ text: 'second message', timestamp: '2026-03-10T10:00:00+05:30' });

    const res = await client.get('/api/messages');

    expect(res.status).toBe(200);
    const data = (res.body as MessageListBody).data;
    expect(data).toHaveLength(2);
    expect(data[0]?.rawText).toBe('second message');
    expect(data[1]?.rawText).toBe('first message');
  });

  it('filters by pipeline status and honours the limit', async () => {
    const account = await registerTestUser(app);
    const client = apiClient(app, account.token);
    await client.post('/api/messages/manual').send({ text: 'only message' });

    const received = await client.get('/api/messages?status=RECEIVED');
    expect((received.body as MessageListBody).data).toHaveLength(1);

    const ignored = await client.get('/api/messages?status=IGNORED');
    expect((ignored.body as MessageListBody).data).toHaveLength(0);

    const limited = await client.get('/api/messages?limit=1');
    expect((limited.body as MessageListBody).data.length).toBeLessThanOrEqual(1);
  });

  it('never mixes another account history into the response', async () => {
    const owner = await registerTestUser(app);
    const stranger = await registerTestUser(app);

    await apiClient(app, owner.token).post('/api/messages/manual').send({ text: 'owner only' });
    const res = await apiClient(app, stranger.token).get('/api/messages');

    expect((res.body as MessageListBody).data).toHaveLength(0);
  });
});