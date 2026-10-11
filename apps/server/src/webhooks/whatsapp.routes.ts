import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../config/logger';
import { DEMO_ACCOUNT } from '../db/seed';
import { ApiError } from '../errors';
import { ingestMessage } from '../messages/ingestion.service';
import { messageRateLimiter } from '../middleware/rate-limit';
import { RawMessage, User } from '../models/index';
import { enqueueMessageForProcessing } from '../workers/processing-queue';

export const whatsappWebhookRouter = Router();

/**
 * Phase 8.1 payload: Twilio's WhatsApp Sandbox posts
 * `application/x-www-form-urlencoded` with these fields. A JSON body with the
 * same shape works too, which keeps manual `curl` testing trivial.
 */
const whatsappWebhookBodySchema = z.object({
  Body: z.string().trim().min(1),
  From: z.string().trim().min(1),
  /** Twilio message id - redeliveries carry the same one and are skipped. */
  MessageSid: z.string().trim().min(1).optional(),
  /** RFC 2822 send time, e.g. "Tue, 10 Mar 2026 09:15:00 +0000". */
  SmsTimestamp: z.string().trim().optional(),
  /** Sender's WhatsApp display name, when Twilio provides it. */
  ProfileName: z.string().trim().min(1).optional(),
});

/** Adapter-instance id recorded on every message that arrives through the webhook. */
const WHATSAPP_SOURCE_ID = 'webhook:whatsapp';
const WHATSAPP_GROUP_NAME = 'WhatsApp Sandbox';

/**
 * Twilio sends RFC 2822 send times; relative phrases in the message ("today",
 * "kal") must resolve against the SEND time, never server receipt time. Falls
 * back to now when the field is absent or unparseable.
 */
function parseSmsTimestamp(value: string | undefined): Date {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * POST /api/webhook/whatsapp - inbound WhatsApp messages (Twilio Sandbox).
 *
 * Unauthenticated by design (Twilio calls us, so `requireAuth` cannot apply):
 * the payload is validated, mapped to the seeded demo account and pushed into
 * the same ingestion path the manual/simulate routes use, so the Groq +
 * MongoDB pipeline runs with no webhook-specific logic. A 200 is returned
 * immediately; processing happens asynchronously in the ingestion worker.
 */
whatsappWebhookRouter.post('/whatsapp', messageRateLimiter, async (req, res) => {
  const body = whatsappWebhookBodySchema.parse(req.body ?? {});

  // Phase 8.1 hardcodes the sender mapping: every sandbox number is the demo user.
  const demoUser = await User.findOne({ email: DEMO_ACCOUNT.email });
  if (!demoUser) {
    throw ApiError.notFound('Demo user not seeded - run `npm run seed` first');
  }
  const userId = demoUser._id;

  // Twilio retries non-2xx deliveries; the same MessageSid must not enqueue twice.
  if (body.MessageSid) {
    const existing = await RawMessage.findOne({ userId, externalId: body.MessageSid });
    if (existing) {
      res.status(200).json({ ok: true, data: { messageId: existing.id, created: false } });
      return;
    }
  }

  const result = await ingestMessage(userId, {
    sourceId: WHATSAPP_SOURCE_ID,
    sourceKind: 'whatsapp',
    externalId: body.MessageSid,
    timestamp: parseSmsTimestamp(body.SmsTimestamp),
    rawText: body.Body,
    senderName: body.ProfileName ?? body.From,
    groupName: WHATSAPP_GROUP_NAME,
    metadata: { from: body.From },
  });

  if (result.created) {
    enqueueMessageForProcessing(result.message.id);
  }

  logger.info(
    { messageId: result.message.id, created: result.created },
    'whatsapp webhook message ingested',
  );

  res.status(200).json({
    ok: true,
    data: { messageId: result.message.id, created: result.created },
  });
});
