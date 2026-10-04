import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

const app = createApp();

interface HealthBody {
  ok: boolean;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string };
}

describe('GET /api/health', () => {
  it('reports the service as healthy', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);

    const body = res.body as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('classsync-server');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('unknown routes', () => {
  it('returns a structured 404 payload', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);

    const body = res.body as ErrorBody;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
