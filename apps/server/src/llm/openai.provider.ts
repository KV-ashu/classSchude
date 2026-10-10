import OpenAI from 'openai';
import type { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from './types';

const DEFAULT_TIMEOUT_MS = 20_000;

/** Groq exposes an OpenAI-compatible API at this base URL. */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Current default on Groq's free tier (older aliases get retired). */
export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

/**
 * OpenAI-SDK-compatible provider. Groq speaks the same protocol as OpenAI,
 * so a single implementation covers any OpenAI-compatible endpoint by
 * swapping `baseURL`. Everything vendor specific stays inside this class.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    /** Defaults to Groq; override for other OpenAI-compatible services. */
    private readonly baseURL: string = GROQ_BASE_URL,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const startedAt = Date.now();
    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: this.timeoutMs,
      maxRetries: 0,
    });

    // Groq's OpenAI-compatible API prefers a developer/system message over the
    // OpenAI-specific "system" role. Fall back to "system" for other hosts.
    const systemRole: 'developer' | 'system' = this.baseURL.includes('groq.com')
      ? 'developer'
      : 'system';

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = request.image
      ? [
          { type: 'text', text: request.prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${request.image.mimeType};base64,${request.image.base64}`,
            },
          },
        ]
      : [{ type: 'text', text: request.prompt }];

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.systemInstruction
      ? [
          { role: systemRole, content: request.systemInstruction },
          { role: 'user', content: userContent },
        ]
      : [{ role: 'user', content: userContent }];

    // Groq's reasoning models (e.g. openai/gpt-oss-*) otherwise prepend a
    // chain-of-thought preamble to the JSON payload, which breaks JSON.parse and
    // the downstream Zod schema. `reasoning_format: "hidden"` suppresses it.
    //
    // This is a Groq extension that is not part of the OpenAI SDK's typed
    // `ChatCompletionCreateParams`, so the body is typed as an intersection. The
    // SDK serialises unknown keys straight through, so Groq still receives it.
    type GroqChatCompletionBody = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
      reasoning_format: 'hidden' | 'parsed' | 'raw';
    };

    const body: GroqChatCompletionBody = {
      model: this.model,
      messages,
      response_format: { type: 'json_object' },
      reasoning_format: 'hidden',
    };

    const response = await client.chat.completions.create(body);

    const rawText = response.choices[0]?.message?.content;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      throw new Error('LLM returned an empty response');
    }

    return {
      json: parseJsonResponse(rawText),
      model: response.model ?? this.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}

function parseJsonResponse(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(`LLM returned malformed JSON: ${rawText.slice(0, 200)}`);
  }
}
