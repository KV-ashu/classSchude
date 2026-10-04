// Mongoose 9 exports no UpdateOptions type; the guard-bypass path is exposed
// through the documented TimetableEntry.updateInternal escape hatch instead.
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { captureError } from '../test-utils/capture-error';
import { clearAllCollections, connectTestDatabase, disconnectTestDatabase } from '../test-utils/db';
import { BaselineImmutableError, Course, TimetableEntry, User } from './index';

const mongoUri = inject('mongoUri');

beforeAll(async () => {
  await connectTestDatabase(mongoUri, 'classsync_test_baseline_guard');
});

beforeEach(async () => {
  await clearAllCollections();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

async function seedBaseline(email = 'baseline@example.com') {
  const user = await User.create({ email, passwordHash: 'hash', displayName: 'Baseline Owner' });
  const course = await Course.create({ userId: user._id, name: 'Database Systems', code: 'DBMS' });
  const entries = await TimetableEntry.insertMany([
    {
      userId: user._id,
      courseId: course._id,
      dayOfWeek: 1,
      startTime: '11:00',
      endTime: '11:50',
      room: 'A-101',
      kind: 'LECTURE',
      baselineVersion: 1,
    },
    {
      userId: user._id,
      courseId: course._id,
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '09:50',
      room: 'A-102',
      kind: 'LECTURE',
      baselineVersion: 1,
    },
  ]);
  const [first, second] = entries;
  if (!first || !second) {
    throw new Error('seedBaseline did not create two entries');
  }
  return { user, first, second };
}

async function seedLockedBaseline() {
  const seeded = await seedBaseline();
  const lockedCount = await TimetableEntry.lockBaseline(seeded.user._id, 1);
  expect(lockedCount).toBe(2);
  return seeded;
}

describe('unlocked baseline', () => {
  it('can be edited', async () => {
    const { first } = await seedBaseline();
    const updated = await TimetableEntry.findByIdAndUpdate(
      first._id,
      { $set: { room: 'B-200' } },
      { returnDocument: 'after' },
    );
    expect(updated?.room).toBe('B-200');
  });

  it('can be deleted', async () => {
    const { first } = await seedBaseline();
    await TimetableEntry.deleteOne({ _id: first._id });
    expect(await TimetableEntry.countDocuments()).toBe(1);
  });
});

describe('lockBaseline', () => {
  it('locks only the requested version and leaves newer drafts editable', async () => {
    const { user, first } = await seedBaseline();
    await TimetableEntry.create({
      userId: user._id,
      courseId: first.courseId,
      dayOfWeek: 3,
      startTime: '10:00',
      endTime: '10:50',
      kind: 'LECTURE',
      baselineVersion: 2,
    });

    const lockedCount = await TimetableEntry.lockBaseline(user._id, 1);

    expect(lockedCount).toBe(2);
    expect(await TimetableEntry.countDocuments({ locked: true })).toBe(2);
    expect(await TimetableEntry.countDocuments({ baselineVersion: 2, locked: false })).toBe(1);
  });
});

describe('locked baseline (immutability contract)', () => {
  it('refuses updateOne', async () => {
    const { first } = await seedLockedBaseline();
    const error = await captureError(
      TimetableEntry.updateOne({ _id: first._id }, { $set: { room: 'Z-999' } }),
    );
    expect(error).toBeInstanceOf(BaselineImmutableError);
    const reloaded = await TimetableEntry.findById(first._id);
    expect(reloaded?.room).toBe('A-101');
  });

  it('refuses findByIdAndUpdate (findOneAndUpdate family)', async () => {
    const { first } = await seedLockedBaseline();
    const error = await captureError(
      TimetableEntry.findByIdAndUpdate(first._id, { $set: { startTime: '12:00' } }, { returnDocument: 'after' }),
    );
    expect(error).toBeInstanceOf(BaselineImmutableError);
  });

  it('refuses deleteOne', async () => {
    const { first } = await seedLockedBaseline();
    const error = await captureError(TimetableEntry.deleteOne({ _id: first._id }));
    expect(error).toBeInstanceOf(BaselineImmutableError);
    expect(await TimetableEntry.countDocuments()).toBe(2);
  });

  it('refuses deleteMany on a user-wide filter', async () => {
    const { user } = await seedLockedBaseline();
    const error = await captureError(TimetableEntry.deleteMany({ userId: user._id }));
    expect(error).toBeInstanceOf(BaselineImmutableError);
    expect(await TimetableEntry.countDocuments()).toBe(2);
  });

  it('refuses save() of a modified locked document', async () => {
    const { first } = await seedLockedBaseline();
    const doc = await TimetableEntry.findById(first._id);
    if (!doc) {
      throw new Error('locked entry disappeared');
    }
    doc.room = 'B-999';
    const error = await captureError(doc.save());
    expect(error).toBeInstanceOf(BaselineImmutableError);
    const reloaded = await TimetableEntry.findById(first._id);
    expect(reloaded?.room).toBe('A-101');
  });

  it('refuses flipping locked back to false (no unlocking)', async () => {
    const { first } = await seedLockedBaseline();
    const error = await captureError(
      TimetableEntry.updateOne({ _id: first._id }, { $set: { locked: false } }),
    );
    expect(error).toBeInstanceOf(BaselineImmutableError);
  });

  it('allows an update whose filter explicitly excludes locked entries (matches nothing)', async () => {
    const { first } = await seedLockedBaseline();
    const result = await TimetableEntry.updateOne(
      { _id: first._id, locked: false },
      { $set: { room: 'N-000' } },
    );
    expect(result.matchedCount).toBe(0);
    const reloaded = await TimetableEntry.findById(first._id);
    expect(reloaded?.room).toBe('A-101');
  });

  it("does not block edits to another user's unlocked baseline", async () => {
    await seedLockedBaseline();
    const other = await seedBaseline('other@example.com');
    const updated = await TimetableEntry.findByIdAndUpdate(
      other.first._id,
      { $set: { room: 'C-1' } },
      { returnDocument: 'after' },
    );
    expect(updated?.room).toBe('C-1');
  });

  it('allows explicitly skipped internal writes (updateInternal escape hatch)', async () => {
    const { first } = await seedLockedBaseline();

    const modifiedCount = await TimetableEntry.updateInternal(first._id, { room: 'INTERNAL-1' });

    expect(modifiedCount).toBe(1);
    const reloaded = await TimetableEntry.findById(first._id);
    expect(reloaded?.room).toBe('INTERNAL-1');
  });

  it('keeps a new baseline version editable until it is locked', async () => {
    const { user, first } = await seedLockedBaseline();
    const draft = await TimetableEntry.create({
      userId: user._id,
      courseId: first.courseId,
      dayOfWeek: 3,
      startTime: '10:00',
      endTime: '10:50',
      kind: 'LECTURE',
      baselineVersion: 2,
    });
    const updated = await TimetableEntry.findByIdAndUpdate(
      draft._id,
      { $set: { room: 'NEW-1' } },
      { returnDocument: 'after' },
    );
    expect(updated?.room).toBe('NEW-1');
  });
});
