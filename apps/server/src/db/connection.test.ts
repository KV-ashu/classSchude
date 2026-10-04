import { afterAll, describe, expect, it, inject } from 'vitest';
import { connectDatabase, disconnectDatabase, isDatabaseConnected } from './connection';

const mongoUri = inject('mongoUri');

describe('connectDatabase', () => {
  it('gives up after the configured retries when the server is unreachable', async () => {
    const startedAt = Date.now();

    await expect(
      connectDatabase({
        uri: 'mongodb://127.0.0.1:59999/classsync_unreachable',
        maxRetries: 2,
        baseDelayMs: 10,
        serverSelectionTimeoutMs: 200,
      }),
    ).rejects.toThrow();

    expect(isDatabaseConnected()).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it('connects to a reachable server and disconnects cleanly', async () => {
    await connectDatabase({ uri: mongoUri, maxRetries: 1, serverSelectionTimeoutMs: 5_000 });
    expect(isDatabaseConnected()).toBe(true);

    await disconnectDatabase();
    expect(isDatabaseConnected()).toBe(false);
  });
});

afterAll(async () => {
  if (isDatabaseConnected()) {
    await disconnectDatabase();
  }
});
