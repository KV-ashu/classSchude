import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

function appWithLimiter(limit: number) {
  const app = express();
  const limiter = createRateLimiter({
    windowMs: 60_000,
    limit,
    code: 'RATE_LIMITED',
    message: 'slow down',
  });
  app.get('/ping', limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('rate limiting', () => {
  it('allows requests up to the limit and then answers 429', async () => {
    const app = appWithLimiter(2);

    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(200);

    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'slow down' },
    });
  });

  it('publishes standard rate limit headers', async () => {
    const app = appWithLimiter(1);

    const res = await request(app).get('/ping');

    // draft-7 exposes a single RateLimit header: limit=N, remaining=N, reset=N
    expect(res.headers['ratelimit']).toContain('limit=1');
  });
});