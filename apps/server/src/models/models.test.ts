import type { MessageSourceKind } from '@classsync/shared';
import mongoose, { Types } from 'mongoose';

const ValidationError = mongoose.Error.ValidationError;
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { captureError } from '../test-utils/capture-error';
import { clearAllCollections, connectTestDatabase, disconnectTestDatabase } from '../test-utils/db';
import { isDuplicateKeyError } from '../utils/mongo-errors';
import { AuditLog, Course, RawMessage, ScheduleChange, TimetableEntry, User } from './index';

const mongoUri = inject('mongoUri');

beforeAll(async () => {
  await connectTestDatabase(mongoUri, 'classsync_test_models');
});

beforeEach(async () => {
  await clearAllCollections();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

async function seedUser() {
  return User.create({
    email: 'Student@Example.COM',
    passwordHash: 'hashed-secret',
    displayName: 'Student',
  });
}

describe('User model', () => {
  it('normalizes the email and applies the default timezone', async () => {
    const user = await seedUser();
    expect(user.email).toBe('student@example.com');
    expect(user.timezone).toBe('Asia/Kolkata');
  });

  it('hides the password hash by default', async () => {
    const user = await seedUser();
    const found = await User.findById(user._id);
    expect(found?.passwordHash).toBeUndefined();
  });

  it('rejects duplicate emails (E11000)', async () => {
    await seedUser();
    const error = await captureError(seedUser());
    expect(isDuplicateKeyError(error)).toBe(true);
  });
});

describe('Course model', () => {
  it('uppercases the code and trims aliases', async () => {
    const user = await seedUser();
    const course = await Course.create({
      userId: user._id,
      name: 'Database Systems',
      code: 'dbms',
      aliases: [' DBMS ', '', ' Database '],
    });
    expect(course.code).toBe('DBMS');
    expect(course.aliases).toEqual(['DBMS', 'Database']);
  });

  it('rejects a duplicate (userId, code)', async () => {
    const user = await seedUser();
    const input = { userId: user._id, name: 'Database Systems', code: 'DBMS' };
    await Course.create(input);
    const error = await captureError(Course.create(input));
    expect(isDuplicateKeyError(error)).toBe(true);
  });
});

describe('TimetableEntry model', () => {
  async function seedEntry(
    overrides: { startTime?: string; endTime?: string; dayOfWeek?: number } = {},
  ) {
    const user = await seedUser();
    const course = await Course.create({
      userId: user._id,
      name: 'Database Systems',
      code: 'DBMS',
    });
    return TimetableEntry.create({
      userId: user._id,
      courseId: course._id,
      dayOfWeek: 1,
      startTime: '11:00',
      endTime: '11:50',
      room: 'A-101',
      kind: 'LECTURE',
      ...overrides,
    });
  }

  it('creates an unlocked v1 entry with defaults', async () => {
    const entry = await seedEntry();
    expect(entry.baselineVersion).toBe(1);
    expect(entry.locked).toBe(false);
  });

  it('rejects a non HH:mm startTime', async () => {
    const error = await captureError(seedEntry({ startTime: '9:00' }));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('rejects an endTime that is not after startTime', async () => {
    const error = await captureError(seedEntry({ endTime: '10:00' }));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('rejects an out-of-range dayOfWeek', async () => {
    const error = await captureError(seedEntry({ dayOfWeek: 8 }));
    expect(error).toBeInstanceOf(ValidationError);
  });
});

describe('RawMessage model', () => {
  async function seedRawMessage(overrides: { sourceKind?: MessageSourceKind; hash?: string } = {}) {
    const user = await seedUser();
    return RawMessage.create({
      userId: user._id,
      sourceId: 'sim:whatsapp-group',
      sourceKind: 'simulator',
      timestamp: new Date('2026-03-10T09:15:00+05:30'),
      rawText: 'kal DBMS cancel hai',
      hash: 'a'.repeat(64),
      ...overrides,
    });
  }

  it('defaults to RECEIVED with no processing errors', async () => {
    const message = await seedRawMessage();
    expect(message.status).toBe('RECEIVED');
    expect(message.processingErrors).toEqual([]);
  });

  it('rejects an unknown source kind', async () => {
    const error = await captureError(
      seedRawMessage({ sourceKind: 'telegram' as unknown as MessageSourceKind }),
    );
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('enforces the unique hash (deduplication at the DB level)', async () => {
    await seedRawMessage();
    const error = await captureError(seedRawMessage());
    expect(isDuplicateKeyError(error)).toBe(true);
  });
});

describe('ScheduleChange model', () => {
  async function seedChange(overrides: { occurrenceDate?: string; confidence?: number } = {}) {
    const user = await seedUser();
    return ScheduleChange.create({
      userId: user._id,
      rawMessageId: new Types.ObjectId(),
      targetEntryId: new Types.ObjectId(),
      occurrenceDate: '2026-03-11',
      action: 'CANCEL',
      confidence: 0.95,
      ...overrides,
    });
  }

  it('defaults to PENDING_REVIEW applied by AI', async () => {
    const change = await seedChange();
    expect(change.status).toBe('PENDING_REVIEW');
    expect(change.appliedBy).toBe('AI');
  });

  it('rejects a malformed occurrenceDate', async () => {
    const error = await captureError(seedChange({ occurrenceDate: '11-03-2026' }));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('rejects confidence outside 0..1', async () => {
    const error = await captureError(seedChange({ confidence: 1.5 }));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('enforces the idempotency key (rawMessageId, action, targetEntryId, occurrenceDate)', async () => {
    const user = await seedUser();
    const base = {
      userId: user._id,
      rawMessageId: new Types.ObjectId(),
      targetEntryId: new Types.ObjectId(),
      occurrenceDate: '2026-03-11',
      action: 'CANCEL' as const,
    };
    await ScheduleChange.create({ ...base, confidence: 0.95 });
    const error = await captureError(ScheduleChange.create({ ...base, confidence: 0.5 }));
    expect(isDuplicateKeyError(error)).toBe(true);
  });
});

describe('AuditLog model', () => {
  it('appends entries with a createdAt timestamp', async () => {
    const user = await seedUser();
    const entry = await AuditLog.create({
      userId: user._id,
      actor: 'SYSTEM',
      action: 'BASELINE_IMPORTED',
      reason: 'initial import',
    });
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.action).toBe('BASELINE_IMPORTED');
  });
});
