import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GROQ_MODEL,
  GROQ_BASE_URL,
  OpenAIProvider,
} from './openai.provider';

const { create, ctorOptions } = vi.hoisted(() => ({
  create: vi.fn(),
  // Captures the options the provider passes to `new OpenAI({...})`.
  ctorOptions: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
    constructor(options: Record<string, unknown>) {
      ctorOptions.current = options;
    }
  },
}));

function jsonResponse(json: unknown, model = DEFAULT_GROQ_MODEL) {
  return { model, choices: [{ message: { content: JSON.stringify(json) } }] };
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    create.mockReset();
    ctorOptions.current = undefined;
  });

  it('targets Groq by default and requests a JSON object', async () => {
    create.mockResolvedValue(jsonResponse({ changes: [] }));
    const provider = new OpenAIProvider('gsk_test', DEFAULT_GROQ_MODEL);

    const result = await provider.complete({ prompt: 'extract' });

    expect(result.json).toEqual({ changes: [] });
    expect(result.model).toBe(DEFAULT_GROQ_MODEL);
    expect(ctorOptions.current).toMatchObject({
      apiKey: 'gsk_test',
      baseURL: GROQ_BASE_URL,
    });

    const call = create.mock.calls.at(-1)?.[0] as {
      model: string;
      response_format: { type: string };
    };
    expect(call.model).toBe(DEFAULT_GROQ_MODEL);
    expect(call.response_format).toEqual({ type: 'json_object' });
  });

  it('maps the system instruction to a developer message for Groq', async () => {
    create.mockResolvedValue(jsonResponse({ changes: [] }));
    const provider = new OpenAIProvider('gsk_test', DEFAULT_GROQ_MODEL);

    await provider.complete({ prompt: 'p', systemInstruction: 'system rules' });

    const call = create.mock.calls.at(-1)?.[0] as {
      messages: { role: string; content: unknown }[];
    };
    expect(call.messages[0]).toEqual({ role: 'developer', content: 'system rules' });
    expect(call.messages[1]?.role).toBe('user');
  });

  it('uses the "system" role for non-Groq base URLs', async () => {
    create.mockResolvedValue(jsonResponse({ changes: [] }));
    const provider = new OpenAIProvider(
      'key',
      DEFAULT_GROQ_MODEL,
      20_000,
      'https://api.openai.com/v1',
    );

    await provider.complete({ prompt: 'p', systemInstruction: 'rules' });

    const call = create.mock.calls.at(-1)?.[0] as {
      messages: { role: string }[];
    };
    expect(call.messages[0]?.role).toBe('system');
  });

  it('omits the system message when none is supplied', async () => {
    create.mockResolvedValue(jsonResponse({ changes: [] }));
    const provider = new OpenAIProvider('gsk_test', DEFAULT_GROQ_MODEL);

    await provider.complete({ prompt: 'p' });

    const call = create.mock.calls.at(-1)?.[0] as { messages: unknown[] };
    expect(call.messages).toHaveLength(1);
  });

  it('sends the image as a base64 data URL when provided', async () => {
    create.mockResolvedValue(jsonResponse({ entries: [] }));
    const provider = new OpenAIProvider('gsk_test', DEFAULT_GROQ_MODEL);

    await provider.complete({
      prompt: 'read the timetable',
      image: { base64: 'AAAA', mimeType: 'image/png' },
    });

    const call = create.mock.calls.at(-1)?.[0] as {
      messages: { role: string; content: { type: string; image_url?: { url: string } }[] }[];
    };
    const content = call.messages[0]?.content ?? [];
    expect(content[0]?.type).toBe('text');
    expect(content[1]?.type).toBe('image_url');
    expect(content[1]?.image_url?.url).toBe('data:image/png;base64,AAAA');
  });

  it('throws when the model returns malformed JSON', async () => {
    create.mockResolvedValue({ model: 'x', choices: [{ message: { content: 'not json' } }] });
    const provider = new OpenAIProvider('gsk_test', DEFAULT_GROQ_MODEL);

    await expect(provider.complete({ prompt: 'p' })).rejects.toThrow(/malformed JSON/);
  });

  it('throws when the response carries no content', async () => {
    create.mockResolvedValue({ model: 'x', choices: [{ message: { content: '   ' } }] });
    const provider = new OpenAIProvider('gsk_test', DEFAULT_GROQ_MODEL);

    await expect(provider.complete({ prompt: 'p' })).rejects.toThrow(/empty response/);
  });
});
