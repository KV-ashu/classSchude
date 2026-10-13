import qrcode from 'qrcode-terminal';
import { Client, LocalAuth, type Contact, type Message } from 'whatsapp-web.js';
import { logger } from '../config/logger';
import { DEMO_ACCOUNT } from '../db/seed';
import { ingestMessage } from '../messages/ingestion.service';
import { User } from '../models/index';
import { enqueueMessageForProcessing } from '../workers/processing-queue';

/** Adapter-instance id recorded on every message that arrives through the linked device. */
const WHATSAPP_SOURCE_ID = 'wa-webjs:default';

/**
 * Phase 8.2: the server itself acts as a WhatsApp Linked Device (whatsapp-web.js).
 *
 * LocalAuth persists the session under `.wwebjs_auth/` so a restart reconnects
 * silently — the QR code is only needed the very first time (or after a logout).
 * Inbound chats are mapped straight to the seeded demo account and pushed into
 * the same ingestion queue the manual/simulate routes use, so the Groq +
 * MongoDB pipeline runs with zero WhatsApp-specific logic.
 */
const client = new Client({
  authStrategy: new LocalAuth({
    // Relative to the process cwd (the repo root under `npm run dev`); git-ignored.
    dataPath: '.wwebjs_auth',
  }),
});

client.on('qr', (qr: string) => {
  logger.info('[whatsapp] scan this QR with WhatsApp -> Linked Devices');
  // small: true keeps the QR compact enough for narrow terminals.
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  logger.info('[whatsapp] client is connected - inbound messages will be ingested');
});

client.on('disconnected', (reason) => {
  logger.warn(
    { reason: String(reason) },
    '[whatsapp] client disconnected - restart the server to re-authenticate',
  );
});

client.on('message', (message: Message) => {
  void handleMessage(message).catch((error: unknown) => {
    logger.error({ error }, '[whatsapp] failed to ingest message');
  });
});

/**
 * Maps one inbound chat onto the shared MessageEvent contract and enqueues it.
 * Errors are swallowed upstream so a bad message can never kill the client.
 */
async function handleMessage(message: Message): Promise<void> {
  const text = message.body.trim();
  if (!text || !message.from) {
    return; // media-only/status messages carry no text — nothing for the pipeline.
  }

  // "1234567890@c.us" -> "1234567890"; group chats keep their "@g.us" id as-is.
  const senderId = message.from.replace(/@c\.us$/, '');

  // Phase 8.2 hardcodes the sender mapping: every number is the demo user.
  const demoUser = await User.findOne({ email: DEMO_ACCOUNT.email });
  if (!demoUser) {
    logger.warn('[whatsapp] demo user not seeded - run `npm run seed` first; message dropped');
    return;
  }

  const result = await ingestMessage(demoUser._id, {
    sourceId: WHATSAPP_SOURCE_ID,
    sourceKind: 'whatsapp',
    // The WA message id makes redeliveries of the same chat deduplicate.
    externalId: message.id._serialized,
    // Unix seconds: relative phrases ("today", "kal") resolve against send time.
    timestamp: new Date(message.timestamp * 1000),
    rawText: text,
    senderName: await resolveSenderName(message, senderId),
    metadata: { from: message.from },
  });

  if (result.created) {
    enqueueMessageForProcessing(result.message.id);
  }

  logger.info(
    { messageId: result.message.id, created: result.created },
    'whatsapp message ingested',
  );
}

/** Sender's WhatsApp display name when the profile is reachable, else the phone number. */
async function resolveSenderName(message: Message, fallback: string): Promise<string> {
  try {
    const contact: Contact = await message.getContact();
    return contact.pushname || contact.name || contact.shortName || fallback;
  } catch {
    return fallback; // privacy settings or a group chat can reject the lookup.
  }
}

/** Starts the linked-device client. Fire-and-forget: the HTTP server must not wait for pairing. */
export function startWhatsAppClient(): void {
  void client.initialize().catch((error: unknown) => {
    logger.error({ error }, '[whatsapp] client failed to initialize');
  });
}

/** Best-effort shutdown on exit so Puppeteer's browser child exits cleanly. */
export function stopWhatsAppClient(): void {
  void client.destroy().catch((error: unknown) => {
    logger.warn({ error }, '[whatsapp] client failed to shut down cleanly');
  });
}
