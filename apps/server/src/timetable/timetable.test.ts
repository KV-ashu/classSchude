import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { TimetableEntry } from '../models/index';
import { apiClient, registerTestUser } from '../test-utils/api';
import { useTestDatabase } from '../test-utils/db';

useTestDatabase('classsync_test_timetable');

const app = createApp();

interface ImportBody {
  data: { version: number; importedCount: number; createdCourseCodes: string[]; replacedDraft: boolean };
}
interface EntryDto {
  id: string;
  courseCode: string | null;
  day: number;
  startTime: string;
  endTime: string;
  room: string | null;
  kind: string;
  baselineVersion: number;
  locked: boolean;
}
interface EntriesBody {
  data: { version: number | null; locked: boolean; entries: EntryDto[] };
}
interface ErrorEnvelope {
  error: { code: string; message: string; details?: { errors?: unknown[] } };
}

const VALID_CSV = [
  'Code,Day,Start,End,Venue,Type',
  'DBMS,1,11:00,11:50,A-101,LECTURE',
  'OS,2,09:00,09:50,B-202,LAB',
].join('\n');

async function seedCourse(token: string, code: string, name: string): Promise<void> {
  const res = await apiClient(app, token).post('/api/courses').send({ name, code });
  expect(res.status).toBe(201);
}

async function seedTwoCourses(token: string): Promise<void> {
  await seedCourse(token, 'DBMS', 'Database Systems');
  await seedCourse(token, 'OS', 'Operating Systems');
}

describe('timetable CSV import', () => {
  it('requires authentication', async () => {
    expect((await apiClient(app).post('/api/timetable/import/csv').send({ csv: VALID_CSV })).status).toBe(401);
  });

  it('imports a draft with alias headers, preserving room and kind', async () => {
    const account = await registerTestUser(app);
    await seedTwoCourses(account.token);

    const res = await apiClient(app, account.token)
      .post('/api/timetable/import/csv')
      .send({ csv: VALID_CSV });

    expect(res.status).toBe(201);
    expect((res.body as ImportBody).data).toMatchObject({
      version: 1,
      importedCount: 2,
      replacedDraft: false,
    });

    const entries = (await apiClient(app, account.token).get('/api/timetable/entries')).body as EntriesBody;
    const [first] = entries.data.entries;
    expect(entries.data.locked).toBe(false);
    expect(entries.data.entries).toHaveLength(2);
    expect(first).toMatchObject({
      courseCode: 'DBMS',
      day: 1,
      startTime: '11:00',
      endTime: '11:50',
      room: 'A-101',
      locked: false,
      baselineVersion: 1,
    });
  });

  it('rejects invalid rows and writes nothing at all', async () => {
    const account = await registerTestUser(app);
    await seedCourse(account.token, 'DBMS', 'Database Systems');

    const res = await apiClient(app, account.token)
      .post('/api/timetable/import/csv')
      .send({ csv: ['Code,Day,Start,End', 'DBMS,1,11:00,11:50', 'DBMS,9,10:00,10:50'].join('\n') });

    expect(res.status).toBe(422);
    expect((res.body as ErrorEnvelope).error.details?.errors).toHaveLength(1);
    expect(await TimetableEntry.countDocuments()).toBe(0);
  });

  it('rejects overlapping classes inside one batch', async () => {
    const account = await registerTestUser(app);
    await seedCourse(account.token, 'DBMS', 'Database Systems');

    const res = await apiClient(app, account.token)
      .post('/api/timetable/import/csv')
      .send({
        csv: ['Code,Day,Start,End', 'DBMS,1,11:00,12:00', 'DBMS,1,11:30,12:30'].join('\n'),
      });

    expect(res.status).toBe(422);
    expect((res.body as ErrorEnvelope).error.message).toContain('overlapping');
    expect(await TimetableEntry.countDocuments()).toBe(0);
  });

  it('requires known courses unless createMissingCourses is set', async () => {
    const account = await registerTestUser(app);
    const csv = ['Code,Day,Start,End', 'NEWCS,1,11:00,11:50'].join('\n');
    const client = apiClient(app, account.token);

    const refused = await client.post('/api/timetable/import/csv').send({ csv });
    expect(refused.status).toBe(422);
    expect((refused.body as ErrorEnvelope).error.message).toContain('unknown courses');

    const created = await client
      .post('/api/timetable/import/csv')
      .send({ csv, createMissingCourses: true });
    expect(created.status).toBe(201);
    expect((created.body as ImportBody).data.createdCourseCodes).toEqual(['NEWCS']);
  });
});

describe('timetable JSON import', () => {
  it('imports structured entries and normalizes the course code', async () => {
    const account = await registerTestUser(app);
    await seedCourse(account.token, 'DBMS', 'Database Systems');

    const res = await apiClient(app, account.token)
      .post('/api/timetable/import/json')
      .send({
        entries: [{ courseCode: 'dbms', day: '3', startTime: '10:00', endTime: '10:50', room: 'C-3' }],
      });

    expect(res.status).toBe(201);
    expect((res.body as ImportBody).data.importedCount).toBe(1);

    const entries = (await apiClient(app, account.token).get('/api/timetable/entries')).body as EntriesBody;
    const [first] = entries.data.entries;
    expect(first).toMatchObject({ courseCode: 'DBMS', day: 3, startTime: '10:00' });
  });
});

describe('review flow', () => {
  it('patches and deletes draft entries before locking', async () => {
    const account = await registerTestUser(app);
    await seedTwoCourses(account.token);
    const client = apiClient(app, account.token);
    await client.post('/api/timetable/import/csv').send({ csv: VALID_CSV });

    const before = (await client.get('/api/timetable/entries')).body as EntriesBody;
    const [first, second] = before.data.entries;
    if (!first || !second) {
      throw new Error('expected two draft entries');
    }

    const patched = await client
      .patch(`/api/timetable/entries/${first.id}`)
      .send({ room: 'Z-9', kind: 'LAB' });
    expect(patched.status).toBe(200);
    expect((patched.body as { data: EntryDto }).data).toMatchObject({ room: 'Z-9', kind: 'LAB' });

    expect((await client.delete(`/api/timetable/entries/${second.id}`)).status).toBe(204);

    const after = (await client.get('/api/timetable/entries')).body as EntriesBody;
    expect(after.data.entries).toHaveLength(1);
  });

  it('rejects a patch that inverts the time range', async () => {
    const account = await registerTestUser(app);
    await seedTwoCourses(account.token);
    const client = apiClient(app, account.token);
    await client.post('/api/timetable/import/csv').send({ csv: VALID_CSV });

    const entries = (await client.get('/api/timetable/entries')).body as EntriesBody;
    const [first] = entries.data.entries;
    if (!first) {
      throw new Error('expected a draft entry');
    }

    const res = await client.patch(`/api/timetable/entries/${first.id}`).send({ startTime: '23:00' });

    expect(res.status).toBe(400);
  });
});

describe('locking the baseline', () => {
  it('refuses to lock when nothing was imported', async () => {
    const account = await registerTestUser(app);

    const res = await apiClient(app, account.token).post('/api/timetable/lock');

    expect(res.status).toBe(400);
  });

  it('locks the draft and freezes every entry', async () => {
    const account = await registerTestUser(app);
    await seedTwoCourses(account.token);
    const client = apiClient(app, account.token);
    await client.post('/api/timetable/import/csv').send({ csv: VALID_CSV });

    const locked = await client.post('/api/timetable/lock');
    expect(locked.status).toBe(200);
    expect((locked.body as { data: { version: number; lockedCount: number } }).data).toEqual({
      version: 1,
      lockedCount: 2,
    });

    const entries = (await client.get('/api/timetable/entries')).body as EntriesBody;
    expect(entries.data.locked).toBe(true);
    expect(entries.data.entries.every((entry) => entry.locked)).toBe(true);

    const [first] = entries.data.entries;
    if (!first) {
      throw new Error('expected entries');
    }

    const patch = await client.patch(`/api/timetable/entries/${first.id}`).send({ room: 'Nope' });
    expect(patch.status).toBe(409);
    expect((patch.body as ErrorEnvelope).error.code).toBe('BASELINE_IMMUTABLE');

    expect((await client.delete(`/api/timetable/entries/${first.id}`)).status).toBe(409);
    expect((await client.post('/api/timetable/lock')).status).toBe(409);
  });

  it('starts a new baseline version after a locked import and keeps history', async () => {
    const account = await registerTestUser(app);
    await seedTwoCourses(account.token);
    const client = apiClient(app, account.token);
    await client.post('/api/timetable/import/csv').send({ csv: VALID_CSV });
    await client.post('/api/timetable/lock');

    const secondImport = await client.post('/api/timetable/import/csv').send({ csv: VALID_CSV });
    expect(secondImport.status).toBe(201);
    expect((secondImport.body as ImportBody).data).toMatchObject({
      version: 2,
      replacedDraft: false,
    });

    const v1 = (await client.get('/api/timetable/entries?version=1')).body as EntriesBody;
    expect(v1.data.entries.every((entry) => entry.locked)).toBe(true);

    const latest = (await client.get('/api/timetable/entries')).body as EntriesBody;
    expect(latest.data.version).toBe(2);
    expect(latest.data.locked).toBe(false);
  });

  it('replaces an unconfirmed draft on re-import instead of piling versions up', async () => {
    const account = await registerTestUser(app);
    await seedCourse(account.token, 'DBMS', 'Database Systems');
    const client = apiClient(app, account.token);

    await client
      .post('/api/timetable/import/csv')
      .send({ csv: 'code,day,start,end\nDBMS,1,11:00,11:50' });
    const second = await client
      .post('/api/timetable/import/csv')
      .send({ csv: 'code,day,start,end\nDBMS,2,09:00,09:50' });

    expect(second.status).toBe(201);
    expect((second.body as ImportBody).data).toMatchObject({ version: 1, replacedDraft: true });

    const entries = (await client.get('/api/timetable/entries')).body as EntriesBody;
    expect(entries.data.entries).toHaveLength(1);
    expect(entries.data.entries[0]).toMatchObject({ day: 2 });
  });
});