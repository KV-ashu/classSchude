export interface LlmImageInput {
  /** Raw base64 payload (no data-URL prefix). */
  base64: string;
  mimeType: string;
}

export interface LlmCompletionRequest {
  prompt: string;
  systemInstruction?: string;
  /** Optional image for multimodal models (Gemini vision). */
  image?: LlmImageInput;
}

export interface LlmCompletionResult {
  /** Parsed JSON from the model. Still untrusted - validate it with Zod. */
  json: unknown;
  model: string;
  latencyMs: number;
}

/**
 * Provider-agnostic LLM access. The rest of the codebase never talks to a
 * vendor SDK directly - it only depends on this interface.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}