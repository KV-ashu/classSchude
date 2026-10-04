import type { MessageEvent } from '@classsync/shared';
import { Types } from 'mongoose';
import { createApp } from '../app';
import { apiClient, registerTestUser, type TestAccount } from './api';

export const app = createApp();

/** 2026-03-10 is a Tuesday; the fixtures below build a Tuesday-only week. */
export const TUESDAY = 2;

export const FIXTURE_MESSAGE_TIMESTAMP = new Date('2026-03-10T04:30:00.000Z');

/**
 * Registers an account with two courses and a LOCKED baseline:
 *   Tuesday 11:00-11:50 DBMS (A-101)
 *   Tuesday 13:00-13:50 OS   (B-202)
 */
export async function seedTimetableAccount(): Promise<TestAccount> {
  const account = await registerTestUser(app);
  const client = apiClient(app, account.token);

  const dbms = await client
    .post('/api/courses')
    .send({ name: 'Database Systems', code: 'DBMS', aliases: ['Database'] });
  const os = await client.post('/api/courses').send({ name: 'Operating Systems', code: 'OS' });

  const imported = await client.post('/api/timetable/import/csv').send({
    csv: [
      'code,day,start,end,venue,type',
      `DBMS,${TUESDAY},11:00,11:50,A-101,LECTURE`,
      `OS,${TUESDAY},13:00,13:50,B-202,LECTURE`,
    ].join('\n'),
  });

  const locked = await client.post('/api/timetable/lock');

  if (dbms.status !== 201 || os.status !== 201) {
    throw new Error(`course seed failed (${dbms.status}/${os.status})`);
  }
  if (imported.status !== 201) {
    throw new Error(`timetable seed failed (${imported.status})`);
  }
  if (locked.status !== 200) {
    throw new Error(`baseline lock failed (${locked.status})`);
  }

  return account;
}

/** Builds an ingestion payload owned by the given account. */
export function buildTestEvent(
  userId: string,
  rawText: string,
  timestamp: Date = FIXTURE_MESSAGE_TIMESTAMP,
): { userId: Types.ObjectId; event: MessageEvent } {
  return {
    userId: new Types.ObjectId(userId),
    event: {
      sourceId: 'manual:test',
      sourceKind: 'manual',
      timestamp,
      rawText,
      senderName: 'Rahul',
      groupName: 'CSE-3A Official',
    },
  };
}