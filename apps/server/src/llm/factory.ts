import { env } from '../config/env';
import { ApiError } from '../errors';
import { GeminiProvider } from './gemini.provider';
import { StubProvider } from './stub.provider';
import type { LlmProvider } from './types';

/** Default model for the free Google AI Studio tier. Older 1.5/2.5 aliases are retired. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/** Builds the configured LLM provider. Throws a 503-flavoured error when unusable. */
export function createLlmProvider(): LlmProvider {
  if (env.LLM_PROVIDER === 'stub') {
    return new StubProvider();
  }

  if (env.LLM_PROVIDER === 'gemini') {
    if (!env.LLM_API_KEY) {
      throw ApiError.serviceUnavailable('LLM_API_KEY must be set when LLM_PROVIDER=gemini');
    }
    return new GeminiProvider(env.LLM_API_KEY, env.LLM_MODEL ?? DEFAULT_GEMINI_MODEL);
  }

  throw ApiError.serviceUnavailable(`LLM provider '${env.LLM_PROVIDER}' is not implemented yet`);
}