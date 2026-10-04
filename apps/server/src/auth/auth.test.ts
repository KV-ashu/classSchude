import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiClient, registerTestUser } from '../test-utils/api';
import { useTestDatabase } from '../test-utils/db';
import { createApp } from '../app';
import { User } from '../models/index';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken, verifyAccessToken } from './tokens';

useTestDatabase('classsync_test_auth');

const app = createApp();
const anonymous = apiClient(app);

interface AuthBody {
  data: { user: { id: string; email: string; displayName: string }; token: string };
}
interface ErrorEnvelope {
  error: { code: string; message: string };
}

describe('password hashing', () => {
  it('stores a salted scrypt hash and verifies it', async () => {
    const hash = await hashPassword('SuperSecret123');

    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('SuperSecret123');
    expect(await verifyPassword('SuperSecret123', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash per call (unique salt)', async () => {
    const [first, second] = await Promise.all([
      hashPassword('SuperSecret123'),
      hashPassword('SuperSecret123'),
    ]);

    expect(first).not.toBe(second);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPassword('SuperSecret123', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('SuperSecret123', 'scrypt$zz$zz')).toBe(false);
  });
});

describe('JWT access tokens', () => {
  it('round-trips the claims', async () => {
    const token = await signAccessToken({ userId: '507f1f77bcf86cd799439011', email: 'a@b.com' });
    const claims = await verifyAccessToken(token);

    expect(claims.userId).toBe('507f1f77bcf86cd799439011');
    expect(claims.email).toBe('a@b.com');
  });

  it('rejects a tampered token', async () => {
    const token = await signAccessToken({ userId: '507f1f77bcf86cd799439011', email: 'a@b.com' });

    await expect(verifyAccessToken(`${token.slice(0, -3)}xyz`)).rejects.toThrow();
  });
});

describe('POST /api/auth/register', () => {
  it('creates an account, returns a token and never leaks the hash', async () => {
    const res = await anonymous.post('/api/auth/register').send({
      email: 'New.Student@Example.com',
      password: 'SuperSecret123',
      displayName: 'New Student',
      college: 'Example Institute',
    });

    expect(res.status).toBe(201);
    const body = res.body as AuthBody;
    expect(body.data.user.email).toBe('new.student@example.com');
    expect(body.data.token.split('.')).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toContain('scrypt$');
  });

  it('rejects a duplicate email with 409', async () => {
    const account = await registerTestUser(app);

    const res = await anonymous
      .post('/api/auth/register')
      .send({ email: account.email, password: 'SuperSecret123', displayName: 'Duplicate' });

    expect(res.status).toBe(409);
    expect((res.body as ErrorEnvelope).error.code).toBe('CONFLICT');
  });

  it('rejects invalid payloads with 422', async () => {
    const shortPassword = await anonymous
      .post('/api/auth/register')
      .send({ email: 'a@b.com', password: 'short', displayName: 'X' });
    expect(shortPassword.status).toBe(422);

    const badEmail = await anonymous
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'SuperSecret123', displayName: 'X' });
    expect(badEmail.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for valid credentials', async () => {
    const account = await registerTestUser(app, { password: 'SuperSecret123' });

    const res = await anonymous
      .post('/api/auth/login')
      .send({ email: account.email, password: 'SuperSecret123' });

    expect(res.status).toBe(200);
    expect((res.body as AuthBody).data.user.email).toBe(account.email);
  });

  it('answers wrong password and unknown account identically (no enumeration)', async () => {
    const account = await registerTestUser(app);

    const wrongPassword = await anonymous
      .post('/api/auth/login')
      .send({ email: account.email, password: 'DefinitelyWrong1' });
    const unknownEmail = await anonymous
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'SuperSecret123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect((wrongPassword.body as ErrorEnvelope).error.message).toBe(
      (unknownEmail.body as ErrorEnvelope).error.message,
    );
  });
});

describe('requireAuth middleware', () => {
  it('rejects missing, malformed and orphaned tokens', async () => {
    expect((await anonymous.get('/api/auth/me')).status).toBe(401);
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', 'Basic abc')).status,
    ).toBe(401);
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt')).status,
    ).toBe(401);

    // Valid signature, but the account no longer exists.
    const account = await registerTestUser(app);
    await User.deleteOne({ _id: account.userId });
    const orphanToken = await signAccessToken({ userId: account.userId, email: account.email });
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${orphanToken}`)).status,
    ).toBe(401);
  });

  it('returns the profile for a valid token', async () => {
    const account = await registerTestUser(app);

    const res = await apiClient(app, account.token).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect((res.body as { data: { email: string } }).data.email).toBe(account.email);
  });

  it('protects every timetable and course endpoint', async () => {
    expect((await anonymous.get('/api/courses')).status).toBe(401);
    expect((await anonymous.post('/api/courses').send({ name: 'X', code: 'X' })).status).toBe(401);
    expect((await anonymous.get('/api/timetable/entries')).status).toBe(401);
    expect((await anonymous.post('/api/timetable/lock')).status).toBe(401);
  });
});