import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { apiClient, registerTestUser } from '../test-utils/api';
import { useTestDatabase } from '../test-utils/db';

useTestDatabase('classsync_test_courses');

const app = createApp();

interface CourseDto {
  id: string;
  name: string;
  code: string;
  aliases: string[];
}
interface CourseBody {
  data: CourseDto;
}
interface CourseListBody {
  data: CourseDto[];
}
interface ErrorEnvelope {
  error: { code: string; message: string };
}

async function seedCourse(token: string, overrides: Record<string, unknown> = {}): Promise<CourseDto> {
  const res = await apiClient(app, token)
    .post('/api/courses')
    .send({ name: 'Database Systems', code: 'DBMS', ...overrides });

  expect(res.status).toBe(201);
  return (res.body as CourseBody).data;
}

describe('course CRUD', () => {
  it('requires authentication', async () => {
    expect((await apiClient(app).get('/api/courses')).status).toBe(401);
  });

  it('creates a course and normalizes the code', async () => {
    const account = await registerTestUser(app);

    const course = await seedCourse(account.token, { code: 'os' });

    expect(course.code).toBe('OS');
  });

  it('rejects a duplicate code for the same user', async () => {
    const account = await registerTestUser(app);
    await seedCourse(account.token);

    const duplicate = await apiClient(app, account.token)
      .post('/api/courses')
      .send({ name: 'Again', code: 'DBMS' });

    expect(duplicate.status).toBe(409);
    expect((duplicate.body as ErrorEnvelope).error.code).toBe('DUPLICATE_KEY');
  });

  it('lists only the caller own courses', async () => {
    const owner = await registerTestUser(app);
    const stranger = await registerTestUser(app);
    await seedCourse(owner.token);

    const list = await apiClient(app, stranger.token).get('/api/courses');

    expect((list.body as CourseListBody).data).toHaveLength(0);
  });

  it('hides another user course behind a 404', async () => {
    const owner = await registerTestUser(app);
    const stranger = await registerTestUser(app);
    const course = await seedCourse(owner.token);

    const res = await apiClient(app, stranger.token).get(`/api/courses/${course.id}`);

    expect(res.status).toBe(404);
  });

  it('rejects a malformed course id with 400', async () => {
    const account = await registerTestUser(app);

    const res = await apiClient(app, account.token).get('/api/courses/not-an-id');

    expect(res.status).toBe(400);
  });

  it('patches fields and merges aliases', async () => {
    const account = await registerTestUser(app);
    const course = await seedCourse(account.token, { aliases: ['Database'] });

    const res = await apiClient(app, account.token)
      .patch(`/api/courses/${course.id}`)
      .send({ name: 'DBMS II', aliases: ['DBS'] });

    expect(res.status).toBe(200);
    const updated = (res.body as CourseBody).data;
    expect(updated.name).toBe('DBMS II');
    expect(updated.aliases).toEqual(expect.arrayContaining(['Database', 'DBS']));
  });

  it('adds and removes a single alias', async () => {
    const account = await registerTestUser(app);
    const course = await seedCourse(account.token);

    const added = await apiClient(app, account.token)
      .post(`/api/courses/${course.id}/aliases`)
      .send({ alias: 'SQL' });
    expect((added.body as CourseBody).data.aliases).toContain('SQL');

    const removed = await apiClient(app, account.token).delete(
      `/api/courses/${course.id}/aliases/${encodeURIComponent('SQL')}`,
    );
    expect((removed.body as CourseBody).data.aliases).not.toContain('SQL');
  });
});

describe('course deletion', () => {
  it('refuses to delete a course referenced by timetable entries', async () => {
    const account = await registerTestUser(app);
    const course = await seedCourse(account.token);

    const imported = await apiClient(app, account.token)
      .post('/api/timetable/import/csv')
      .send({ csv: 'code,day,start,end\nDBMS,1,11:00,11:50' });
    expect(imported.status).toBe(201);

    const res = await apiClient(app, account.token).delete(`/api/courses/${course.id}`);

    expect(res.status).toBe(409);
    expect((res.body as ErrorEnvelope).error.message).toContain('referenced');
  });

  it('deletes an unreferenced course', async () => {
    const account = await registerTestUser(app);
    const course = await seedCourse(account.token);

    const res = await apiClient(app, account.token).delete(`/api/courses/${course.id}`);

    expect(res.status).toBe(204);
    expect((await apiClient(app, account.token).get(`/api/courses/${course.id}`)).status).toBe(404);
  });
});