import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { captureError } from '../test-utils/capture-error';
import { clearAllCollections, connectTestDatabase, disconnectTestDatabase } from '../test-utils/db';
import { AuditLog, AuditLogImmutableError, User } from './index';

const mongoUri = inject('mongoUri');

beforeAll(async () => {
  await connectTestDatabase(mongoUri, 'classsync_test_audit_guard');
});

beforeEach(async () => {
  await clearAllCollections();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

async function seedAuditEntry() {
  const user = await User.create({
    email: 'audit@example.com',
    passwordHash: 'hash',
    displayName: 'Auditor',
  });
  const entry = await AuditLog.create({
    userId: user._id,
    actor: 'AI',
    action: 'CHANGE_APPLIED',
    occurrenceDate: '2026-03-11',
    beforeSnapshot: { startTime: '11:00', endTime: '11:50', room: 'A-101' },
    afterSnapshot: { startTime: '11:00', endTime: '11:50', room: 'A-101' },
    reason: 'auto-applied from message',
  });
  return { user, entry };
}

describe('AuditLog append-only guard', () => {
  it('allows appending entries', async () => {
    const { entry } = await seedAuditEntry();
    expect(entry.id).toBeDefined();
    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('refuses updateOne', async () => {
    const { entry } = await seedAuditEntry();
    const error = await captureError(
      AuditLog.updateOne({ _id: entry._id }, { $set: { reason: 'edited' } }),
    );
    expect(error).toBeInstanceOf(AuditLogImmutableError);
  });

  it('refuses findOneAndUpdate', async () => {
    const { entry } = await seedAuditEntry();
    const error = await captureError(
      AuditLog.findOneAndUpdate({ _id: entry._id }, { $set: { reason: 'edited' } }),
    );
    expect(error).toBeInstanceOf(AuditLogImmutableError);
  });

  it('refuses deletion', async () => {
    await seedAuditEntry();
    const error = await captureError(AuditLog.deleteMany({}));
    expect(error).toBeInstanceOf(AuditLogImmutableError);
    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('keeps history intact after refused mutations', async () => {
    const { entry } = await seedAuditEntry();
    await captureError(AuditLog.updateOne({ _id: entry._id }, { $set: { reason: 'edited' } }));
    const reloaded = await AuditLog.findById(entry._id);
    expect(reloaded?.reason).toBe('auto-applied from message');
  });
});
