import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { requireAuth, requireAuthContext } from '../auth/auth.middleware';
import { ApiError } from '../errors';
import { requireObjectIdParam } from '../http/require-object-id-param';
import { RawMessage, type RawMessageDocument } from '../models/index';
import { listRecentRawMessages } from '../repositories/raw-message.repository';
import { messageAdapters } from './adapters';
import { ingestMessage } from './ingestion.service';
import { processRawMessage, type ProcessResult } from './processing/processor';
import { messageRateLimiter } from '../middleware/rate-limit';
import { enqueueMessageForProcessing } from '../workers/processing-queue';
import {
  listMessagesQuerySchema,
  manualMessageBodySchema,
  simulateMessageBodySchema,
} from './message.schemas';

export const messageRouter = Router();

// Ingestion is private: a message always belongs to one account.
messageRouter.use(requireAuth);

interface MessageDto {
  id: string;
  sourceKind: string;
  sourceId: string;
  externalId: string | null;
  senderName: string | null;
  groupName: string | null;
  timestamp: string;
  rawText: string;
  status: string;
  processingErrors: string[];
  createdAt: string;
}

type IngestedMessageDto = MessageDto & { created: boolean; processing?: ProcessResult | null };

function toMessageDto(message: RawMessageDocument): MessageDto {
  return {
    id: message.id,
    sourceKind: message.sourceKind,
    sourceId: message.sourceId,
    externalId: message.externalId ?? null,
    senderName: message.senderName ?? null,
    groupName: message.groupName ?? null,
    timestamp: message.timestamp.toISOString(),
    rawText: message.rawText,
    status: message.status,
    processingErrors: message.processingErrors,
    createdAt: message.createdAt.toISOString(),
  };
}

function currentUserId(req: Request): Types.ObjectId {
  return new Types.ObjectId(requireAuthContext(req).userId);
}

messageRouter.post('/manual', messageRateLimiter, async (req, res) => {
  const userId = currentUserId(req);
  const body = manualMessageBodySchema.parse(req.body);
  await messageAdapters.ensureStarted();

  const event = messageAdapters.manual.publish({
    rawText: body.text,
    senderName: body.senderName,
    groupName: body.groupName,
    timestamp: body.timestamp,
    externalId: body.externalId,
  });
  const result = await ingestMessage(userId, event);
  // Without `process: true` the background worker picks it up and pushes a
  // real-time update; the UI refetches when the pipeline finishes.
  if (result.created && !body.process) {
    enqueueMessageForProcessing(result.message.id);
  }
  const processing =
    body.process && result.created ? await processRawMessage(result.message.id) : null;
  const data: IngestedMessageDto = {
    ...toMessageDto(result.message),
    created: result.created,
    processing,
  };

  res.status(result.created ? 201 : 200).json({ ok: true, data });
});

messageRouter.post('/simulate', messageRateLimiter, async (req, res) => {
  const userId = currentUserId(req);
  const body = simulateMessageBodySchema.parse(req.body ?? {});
  await messageAdapters.ensureStarted();

  if (body.mode === 'reset') {
    messageAdapters.simulation.reset();
    res.json({
      ok: true,
      data: {
        mode: 'reset',
        total: messageAdapters.simulation.total,
        remaining: messageAdapters.simulation.remaining,
        ingested: [],
      },
    });
    return;
  }

  const events =
    body.mode === 'all'
      ? messageAdapters.simulation.publishRemaining()
      : [messageAdapters.simulation.publishNext()];

  const ingested: IngestedMessageDto[] = [];
  for (const event of events) {
    const result = await ingestMessage(userId, event);
    if (result.created) {
      enqueueMessageForProcessing(result.message.id);
    }
    const processing =
      body.process && result.created ? await processRawMessage(result.message.id) : null;
    ingested.push({ ...toMessageDto(result.message), created: result.created, processing });
  }

  res.status(201).json({
    ok: true,
    data: {
      mode: body.mode,
      ingested,
      createdCount: ingested.filter((message) => message.created).length,
      duplicateCount: ingested.filter((message) => !message.created).length,
      remaining: messageAdapters.simulation.remaining,
    },
  });
});

/** Catalog of the scripted scenario, so the demo UI can show what is coming. */
messageRouter.get('/simulate', (_req, res) => {
  const scenario = messageAdapters.simulation.list();
  res.json({
    ok: true,
    data: {
      total: scenario.length,
      remaining: messageAdapters.simulation.remaining,
      messages: scenario.map((message, index) => ({
        index,
        senderName: message.senderName,
        groupName: message.groupName,
        minutesAgo: message.minutesAgo,
        text: message.text,
      })),
    },
  });
});

/** Runs the processing pipeline for one stored message. */
messageRouter.post('/:id/process', async (req, res) => {
  const userId = currentUserId(req);
  const messageId = requireObjectIdParam(req.params.id, 'message id');

  const message = await RawMessage.findOne({ _id: messageId, userId });
  if (!message) {
    throw ApiError.notFound('Message not found');
  }

  const processing = await processRawMessage(messageId);

  res.json({ ok: true, data: { message: toMessageDto(message), processing } });
});

/** Single message lookup - used by the review queue to show the source text. */
messageRouter.get('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const messageId = requireObjectIdParam(req.params.id, 'message id');

  const message = await RawMessage.findOne({ _id: messageId, userId });
  if (!message) {
    throw ApiError.notFound('Message not found');
  }

  res.json({ ok: true, data: toMessageDto(message) });
});

messageRouter.get('/', async (req, res) => {
  const userId = currentUserId(req);
  const query = listMessagesQuerySchema.parse(req.query);

  const messages = await listRecentRawMessages(userId, query.limit);
  const filtered = query.status
    ? messages.filter((message) => message.status === query.status)
    : messages;

  res.json({ ok: true, data: filtered.map(toMessageDto) });
});