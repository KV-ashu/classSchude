import { GoogleGenAI } from '@google/genai';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from './types';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Google Gemini provider built on the official `@google/genai` SDK.
 * Everything vendor specific stays inside this class.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const startedAt = Date.now();
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const parts = request.image
      ? [
          { text: request.prompt },
          { inlineData: { data: request.image.base64, mimeType: request.image.mimeType } },
        ]
      : [{ text: request.prompt }];

    const response: unknown = await withTimeout(
      ai.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
        },
      }),
      this.timeoutMs,
    );

    const rawText = await readResponseText(response);
    return {
      json: parseJsonResponse(rawText),
      model: this.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Supports both the property and method shape of the SDK response text. */
async function readResponseText(response: unknown): Promise<string> {
  const text = (response as { text?: unknown } | null)?.text;
  const resolved =
    typeof text === 'function' ? await (text as () => Promise<string> | string)() : text;

  if (typeof resolved !== 'string' || resolved.trim().length === 0) {
    throw new Error('Gemini returned an empty response');
  }
  return resolved;
}

function parseJsonResponse(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(`Gemini returned malformed JSON: ${rawText.slice(0, 200)}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`LLM request timed out after ${timeoutMs}ms`));
      }, timeoutMs).unref();
    }),
  ]);
}