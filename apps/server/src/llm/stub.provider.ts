import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from './types';

/**
 * Deterministic offline provider. Returns a fixed payload and never touches
 * the network - used by tests and by `LLM_PROVIDER=stub` local development.
 * The default satisfies both provider contracts (extraction and vision vision
 * schema) with empty results, so callers exercise their empty-input paths.
 */
export class StubProvider implements LlmProvider {
  readonly name = 'stub';
  readonly model = 'stub';

  constructor(private readonly payload: unknown = { changes: [], entries: [] }) {}

  async complete(_request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return { json: this.payload, model: this.model, latencyMs: 0 };
  }
}