import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createLlmProvider } from '../llm/factory';
import { StubProvider } from '../llm/stub.provider';
import type { LlmProvider } from '../llm/types';
import { apiClient, registerTestUser } from '../test-utils/api';
import { useTestDatabase } from '../test-utils/db';
import { extractTimetableFromImage, stripDataUrlPrefix } from './image-import';

useTestDatabase('classsync_test_image_import');

const app = createApp();
const IMAGE = { base64: 'aGVsbG8=', mimeType: 'image/png' };

class FailingProvider implements LlmProvider {
  readonly name = 'failing';
  readonly model = 'failing-model';

  async complete(): Promise<never> {
    throw new Error('quota exceeded');
  }
}

describe('stripDataUrlPrefix', () => {
  it('removes a data-URL prefix and leaves raw base64 untouched', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,AAAA')).toBe('AAAA');
    expect(stripDataUrlPrefix('AAAA')).toBe('AAAA');
  });
});

describe('extractTimetableFromImage', () => {
  it('normalizes the model response into canonical rows', async () => {
    const provider = new StubProvider({
      entries: [
        { courseCode: 'DBMS', day: 1, startTime: '11:00', endTime: '11:50', room: 'A-101' },
        { courseName: 'Operating Systems', day: 2, startTime: '09:00', endTime: '09:50', kind: 'LAB' },
      ],
    });

    const result = await extractTimetableFromImage(provider, IMAGE);

    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ courseCode: 'DBMS', day: 1, room: 'A-101', kind: 'LECTURE' });
    expect(result.rows[1]).toMatchObject({ courseCode: 'Operating Systems', kind: 'LAB' });
    expect(result.promptVersion).toBe('vision-v1');
  });

  it('collects per-entry errors instead of discarding the whole image', async () => {
    const provider = new StubProvider({
      entries: [
        { courseCode: 'DBMS', day: 1, startTime: '11:00', endTime: '11:50' },
        { courseCode: 'OS', day: 1, startTime: '11:00', endTime: '10:00' },
      ],
    });

    const result = await extractTimetableFromImage(provider, IMAGE);

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.row).toBe(2);
  });

  it('rejects an unexpected response structure with 422', async () => {
    const provider = new StubProvider({ timetable: 'not an entries array' });

    await expect(extractTimetableFromImage(provider, IMAGE)).rejects.toMatchObject({
      status: 422,
    });
  });

  it('rejects an entry without any course identifier', async () => {
    const provider = new StubProvider({
      entries: [{ day: 1, startTime: '11:00', endTime: '11:50' }],
    });

    const result = await extractTimetableFromImage(provider, IMAGE);

    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]?.field).toBe('courseCode');
  });

  it('maps provider failures to 503', async () => {
    await expect(extractTimetableFromImage(new FailingProvider(), IMAGE)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('image import endpoint', () => {
  it('requires authentication', async () => {
    const res = await apiClient(app)
      .post('/api/timetable/import/image')
      .send({ imageBase64: 'AAAA' });

    expect(res.status).toBe(401);
  });

  it('runs through the configured provider and refuses an empty extraction', async () => {
    const account = await registerTestUser(app);

    // The stub provider returns no entries, so the import must fail loudly.
    const res = await apiClient(app, account.token)
      .post('/api/timetable/import/image')
      .send({ imageBase64: 'data:image/png;base64,AAAA', mimeType: 'image/png' });

    expect(res.status).toBe(422);
    expect((res.body as { error: { message: string } }).error.message).toContain('no rows');
  });
});

describe('llm provider factory', () => {
  it('builds the stub provider when LLM_PROVIDER=stub (the test default)', () => {
    expect(createLlmProvider().name).toBe('stub');
  });
});