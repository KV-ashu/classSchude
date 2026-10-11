import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { DEMO_ACCOUNT, seedDemoData } from '../db/seed';
import { RawMessage, User } from '../models/index';
import { useTestDatabase } from '../test-utils/db';
import { clearProcessingQueue, pendingMessageCount } from '../workers/processing-queue';

useTestDatabase('classsync_test_webhook');

const app = createApp();

beforeEach(() => {
  clearProcessingQueue();
});

interface WebhookResponseBody {
  ok: boolean;
  data: { messageId: string; created: boolean };
}

/** Simulates the form-encoded POST Twilio's WhatsApp Sandbox sends. */
function sendSandboxMessage(overrides: Record<string, string> = {}) {
  return request(app)
    .post('/api/webhook/whatsapp')
    .type('form')
    .send({
      Body: 'DBMS class cancelled today',
      From: 'whatsapp:+15550001111',
      MessageSid: 'SM-test-001',
      SmsTimestamp: 'Tue, 10 Mar 2026 09:15:00 +0000',
      ...overrides,
    });
}

describe('POST /api/webhook/whatsapp', () => {
  it('rejects a payload without Body with 422', async () => {
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .type('form')
      .send({ From: 'whatsapp:+15550001111' });

    expect(res.status).toBe(422);
    expect(await RawMessage.countDocuments()).toBe(0);
    expect(pendingMessageCount()).toBe(0);
  });

  it('returns 404 when the demo user has not been seeded', async () => {
    const res = await sendSandboxMessage();

    expect(res.status).toBe(404);
    expect(await RawMessage.countDocuments()).toBe(0);
  });

  it('ingests the message for the demo user and queues it for the pipeline', async () => {
    await seedDemoData();

    const res = await sendSandboxMessage();

    expect(res.status).toBe(200);
    const body = res.body as WebhookResponseBody;
    expect(body.ok).toBe(true);
    expect(body.data.created).toBe(true);

    const demoUser = await User.findOne({ email: DEMO_ACCOUNT.email });
    const message = await RawMessage.findById(body.data.messageId);
    expect(message).not.toBeNull();
    expect(message?.userId.toString()).toBe(demoUser?._id.toString());
    expect(message?.sourceKind).toBe('whatsapp');
    expect(message?.sourceId).toBe('webhook:whatsapp');
    expect(message?.externalId).toBe('SM-test-001');
    expect(message?.senderName).toBe('whatsapp:+15550001111');
    expect(message?.rawText).toBe('DBMS class cancelled today');
    expect(message?.timestamp.toISOString()).toBe('2026-03-10T09:15:00.000Z');
    expect(message?.status).toBe('RECEIVED');
    // The background worker drains exactly this queue - webhook and manual share the path.
    expect(pendingMessageCount()).toBe(1);
  });

  it('acknowledges a Twilio retry without duplicating the message', async () => {
    await seedDemoData();

    const first = await sendSandboxMessage();
    const retry = await sendSandboxMessage();

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const retryBody = retry.body as WebhookResponseBody;
    expect(retryBody.ok).toBe(true);
    expect(retryBody.data.created).toBe(false);
    expect(await RawMessage.countDocuments()).toBe(1);
    expect(pendingMessageCount()).toBe(1);
  });

  it('accepts a JSON payload with the same field names', async () => {
    await seedDemoData();

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({ Body: 'OS lab moved to LAB-2', From: 'whatsapp:+15550002222', ProfileName: 'Rahul' });

    expect(res.status).toBe(200);
    expect((res.body as WebhookResponseBody).data.created).toBe(true);
    const message = await RawMessage.findOne({ sourceKind: 'whatsapp' });
    expect(message?.senderName).toBe('Rahul');
    expect(await RawMessage.countDocuments()).toBe(1);
    expect(pendingMessageCount()).toBe(1);
  });
});
