import { describe, expect, it } from 'vitest';
import { DEV_JWT_SECRET, loadEnv } from './env';

const TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/classsync';

/**
 * Success-path helper: MONGODB_URI is required from process.env (never a
 * hardcoded default in src), so every happy-path case supplies it here.
 */
function loadEnvWithUri(source: NodeJS.ProcessEnv = {}): ReturnType<typeof loadEnv> {
  return loadEnv({ MONGODB_URI: TEST_MONGODB_URI, ...source });
}

describe('loadEnv', () => {
  it('applies development defaults when nothing is set', () => {
    const env = loadEnvWithUri();
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.LLM_PROVIDER).toBe('stub');
    expect(env.TZ_DEFAULT).toBe('Asia/Kolkata');
    expect(env.MONGODB_URI).toBe(TEST_MONGODB_URI);
  });

  it('requires MONGODB_URI to come from process.env (never hardcoded)', () => {
    expect(() => loadEnv({})).toThrow(/MONGODB_URI/);
  });

  it('coerces PORT from its string representation', () => {
    expect(loadEnvWithUri({ PORT: '5123' }).PORT).toBe(5123);
  });

  it('rejects a non-numeric PORT with a readable report', () => {
    expect(() => loadEnvWithUri({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('rejects an unknown LLM provider', () => {
    expect(() => loadEnvWithUri({ LLM_PROVIDER: 'mistral' })).toThrow(/LLM_PROVIDER/);
  });

  it('accepts the gemini provider (locked decision: @google/genai)', () => {
    expect(loadEnvWithUri({ LLM_PROVIDER: 'gemini' }).LLM_PROVIDER).toBe('gemini');
  });

  it('accepts the openai provider (Groq / OpenAI-compatible endpoints)', () => {
    const env = loadEnvWithUri({ LLM_PROVIDER: 'openai' });
    expect(env.LLM_PROVIDER).toBe('openai');
  });

  it('reads the provider-specific GROQ_API_KEY and LLM_BASE_URL overrides', () => {
    const env = loadEnvWithUri({
      LLM_PROVIDER: 'openai',
      GROQ_API_KEY: 'gsk_test',
      LLM_BASE_URL: 'https://api.groq.com/openai/v1',
    });
    expect(env.GROQ_API_KEY).toBe('gsk_test');
    expect(env.LLM_BASE_URL).toBe('https://api.groq.com/openai/v1');
  });

  it('treats empty GROQ_API_KEY and LLM_BASE_URL as unset', () => {
    const env = loadEnvWithUri({ GROQ_API_KEY: '', LLM_BASE_URL: '' });
    expect(env.GROQ_API_KEY).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
  });

  it('treats empty optional values as unset', () => {
    const env = loadEnvWithUri({ LLM_API_KEY: '', LLM_MODEL: '' });
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.LLM_MODEL).toBeUndefined();
  });

  it('refuses the dev JWT secret in production', () => {
    expect(() => loadEnvWithUri({ NODE_ENV: 'production', JWT_SECRET: DEV_JWT_SECRET })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('accepts a strong custom secret in production', () => {
    const env = loadEnvWithUri({ NODE_ENV: 'production', JWT_SECRET: 'a-strong-unique-secret' });
    expect(env.JWT_SECRET).toBe('a-strong-unique-secret');
  });
});
