import request from 'supertest';
import type { Express } from 'express';

type SupertestTest = ReturnType<ReturnType<typeof request>['get']>;

/** Minimal supertest wrapper that attaches the bearer token to every request. */
export interface ApiClient {
  get(url: string): SupertestTest;
  post(url: string): SupertestTest;
  patch(url: string): SupertestTest;
  delete(url: string): SupertestTest;
}

export function apiClient(app: Express, token?: string): ApiClient {
  const withAuth = (test: SupertestTest): SupertestTest =>
    token ? test.set('Authorization', `Bearer ${token}`) : test;

  return {
    get: (url) => withAuth(request(app).get(url)),
    post: (url) => withAuth(request(app).post(url)),
    patch: (url) => withAuth(request(app).patch(url)),
    delete: (url) => withAuth(request(app).delete(url)),
  };
}

export interface TestAccount {
  token: string;
  userId: string;
  email: string;
}

let accountCounter = 0;

interface RegisterResponseBody {
  data: { user: { id: string; email: string }; token: string };
}

/** Registers a fresh account and returns its token (used as test fixtures). */
export async function registerTestUser(
  app: Express,
  overrides: { password?: string; displayName?: string } = {},
): Promise<TestAccount> {
  accountCounter += 1;
  const email = `student${accountCounter}-${Date.now()}@example.com`;
  const password = overrides.password ?? 'SuperSecret123';

  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password, displayName: overrides.displayName ?? 'Test Student' });

  if (response.status !== 201) {
    throw new Error(`registerTestUser failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  const body = response.body as RegisterResponseBody;
  return { token: body.data.token, userId: body.data.user.id, email: body.data.user.email };
}