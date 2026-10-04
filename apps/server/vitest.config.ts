import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    hookTimeout: 120_000,
    testTimeout: 20_000,
    // Tests are not users: keep the production rate limits out of the way.
    env: {
      AUTH_RATE_LIMIT_MAX: '100000',
      MESSAGE_RATE_LIMIT_MAX: '100000',
      WORKER_ENABLED: 'false',
    },
  },
});

