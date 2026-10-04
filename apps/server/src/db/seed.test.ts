import { describe, expect, it } from 'vitest';
import { Course, TimetableEntry, User } from '../models/index';
import { useTestDatabase } from '../test-utils/db';
import { DEMO_ACCOUNT, seedDemoData } from './seed';

useTestDatabase('classsync_test_seed');

describe('demo seed', () => {
  it('creates a demo account with courses and a locked baseline', async () => {
    const summary = await seedDemoData();

    expect(summary.email).toBe(DEMO_ACCOUNT.email);
    expect(summary.courses).toBe(7);
    expect(summary.entries).toBe(summary.lockedEntries);
    expect(summary.lockedEntries).toBeGreaterThan(0);

    const user = await User.findOne({ email: DEMO_ACCOUNT.email });
    if (!user) {
      throw new Error('demo user was not created');
    }

    expect(await Course.countDocuments({ userId: user._id })).toBe(7);
    const entries = await TimetableEntry.find({ userId: user._id });
    expect(entries).toHaveLength(summary.entries);
    expect(entries.every((entry) => entry.locked)).toBe(true);
    expect(entries.every((entry) => entry.baselineVersion === 1)).toBe(true);
  });

  it('is idempotent when re-run', async () => {
    await seedDemoData();
    const summary = await seedDemoData();

    expect(summary.courses).toBe(7);
    expect(summary.lockedEntries).toBe(summary.entries);
    expect(await User.countDocuments({ email: DEMO_ACCOUNT.email })).toBe(1);
  });
});