import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { clearAllCollections, connectTestDatabase, disconnectTestDatabase } from '../test-utils/db';
import {
  appendAuditLog,
  createCourse,
  createScheduleChange,
  createTimetableEntry,
  createUser,
  findCourseByCode,
  findLatestBaselineVersion,
  findUserById,
  findUserForAuth,
  insertRawMessage,
  listAuditLogByUser,
  listChangesByUser,
  listPendingReview,
  listRecentRawMessages,
  lockBaseline,
  updateChangeStatus,
  updateRawMessageStatus,
} from './index';

const mongoUri = inject('mongoUri');

beforeAll(async () => {
  await connectTestDatabase(mongoUri, 'classsync_test_repositories');
});

beforeEach(async () => {
  await clearAllCollections();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

function hashOf(character: string): string {
  return character.repeat(64);
}

async function seedUser() {
  return createUser({
    email: 'repo@example.com',
    passwordHash: 'hashed',
    displayName: 'Repo User',
  });
}

function rawMessageInput(userId: Types.ObjectId, hashCharacter: string) {
  return {
    userId,
    sourceId: 'sim:whatsapp-group',
    sourceKind: 'simulator' as const,
    timestamp: new Date('2026-03-10T09:15:00+05:30'),
    rawText: 'kal DBMS cancel hai',
    hash: hashOf(hashCharacter),
  };
}

describe('user.repository', () => {
  it('returns the hash only for auth lookups', async () => {
    const user = await seedUser();
    const forAuth = await findUserForAuth('REPO@example.com');
    expect(forAuth?.passwordHash).toBe('hashed');
    const plain = await findUserById(user.id);
    expect(plain?.passwordHash).toBeUndefined();
  });
});

describe('course.repository', () => {
  it('creates courses and finds them by normalized code', async () => {
    const user = await seedUser();
    await createCourse({ userId: user._id, name: 'Database Systems', code: 'DBMS' });
    await createCourse({ userId: user._id, name: 'Operating Systems', code: 'OS' });
    const found = await findCourseByCode(user._id, 'dbms');
    expect(found?.name).toBe('Database Systems');
  });
});

describe('timetable-entry.repository', () => {
  it('creates entries, reports the latest version and locks it', async () => {
    const user = await seedUser();
    const course = await createCourse({ userId: user._id, name: 'Database Systems', code: 'DBMS' });
    await createTimetableEntry({
      userId: user._id,
      courseId: course._id,
      dayOfWeek: 1,
      startTime: '11:00',
      endTime: '11:50',
      room: 'A-101',
    });
    expect(await findLatestBaselineVersion(user._id)).toBe(1);
    expect(await lockBaseline(user._id, 1)).toBe(1);
  });
});

describe('raw-message.repository', () => {
  it('deduplicates on hash: second insert returns the existing message', async () => {
    const user = await seedUser();
    const input = rawMessageInput(user._id, 'a');

    const first = await insertRawMessage(input);
    expect(first.created).toBe(true);

    const second = await insertRawMessage(input);
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(await listRecentRawMessages(user._id)).toHaveLength(1);
  });

  it('updates the pipeline status together with processing errors', async () => {
    const user = await seedUser();
    const { message } = await insertRawMessage(rawMessageInput(user._id, 'b'));

    const updated = await updateRawMessageStatus(message.id, 'FAILED', ['LLM timeout']);

    expect(updated?.status).toBe('FAILED');
    expect(updated?.processingErrors).toEqual(['LLM timeout']);
  });
});

describe('schedule-change.repository', () => {
  it('creates changes, lists pending review and updates the status', async () => {
    const user = await seedUser();
    const change = await createScheduleChange({
      userId: user._id,
      rawMessageId: new Types.ObjectId(),
      targetEntryId: new Types.ObjectId(),
      occurrenceDate: '2026-03-11',
      action: 'CANCEL',
      confidence: 0.82,
      confidenceFactors: { certainty: 0.9, aliasMatch: 0.95, ambiguityPenalty: 0.1 },
    });
    expect(change.status).toBe('PENDING_REVIEW');

    expect(await listPendingReview(user._id)).toHaveLength(1);

    const approved = await updateChangeStatus(change.id, 'APPLIED_MANUALLY');
    expect(approved?.status).toBe('APPLIED_MANUALLY');
    expect(await listPendingReview(user._id)).toHaveLength(0);
    expect(await listChangesByUser(user._id)).toHaveLength(1);
  });
});

describe('audit-log.repository', () => {
  it('appends entries that can be listed per user', async () => {
    const user = await seedUser();
    await appendAuditLog({ userId: user._id, actor: 'USER', action: 'BASELINE_LOCKED' });
    await appendAuditLog({ userId: user._id, actor: 'AI', action: 'CHANGE_APPLIED' });

    const entries = await listAuditLogByUser(user._id);
    expect(entries).toHaveLength(2);
  });
});
