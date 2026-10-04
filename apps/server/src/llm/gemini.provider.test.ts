import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './gemini.provider';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  // A class (not an arrow function) so `new GoogleGenAI()` works in the provider.
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

interface GenerateCall {
  model: string;
  contents: { role: string; parts: unknown[] }[];
  config: { responseMimeType: string; systemInstruction?: string };
}

function lastCall(): GenerateCall {
  const call = generateContent.mock.calls.at(-1)?.[0] as GenerateCall;
  return call;
}

describe('GeminiProvider', () => {
  beforeEach(() => {
    generateContent.mockReset();
  });

  it('sends the prompt plus the image and parses the JSON response', async () => {
    generateContent.mockResolvedValue({
      text: '{"entries":[{"courseCode":"DBMS","day":1,"startTime":"11:00","endTime":"11:50"}]}',
    });
    const provider = new GeminiProvider('test-key', 'gemini-1.5-flash');

    const result = await provider.complete({
      prompt: 'extract the timetable',
      systemInstruction: 'rules',
      image: { base64: 'AAAA', mimeType: 'image/png' },
    });

    expect(result.model).toBe('gemini-1.5-flash');
    expect(result.json).toEqual({
      entries: [{ courseCode: 'DBMS', day: 1, startTime: '11:00', endTime: '11:50' }],
    });

    const call = lastCall();
    expect(call.model).toBe('gemini-1.5-flash');
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.systemInstruction).toBe('rules');
    expect(call.contents.at(0)?.parts).toHaveLength(2);
  });

  it('omits the image part when no image is supplied', async () => {
    generateContent.mockResolvedValue({ text: '{"entries":[]}' });
    const provider = new GeminiProvider('test-key', 'gemini-1.5-flash');

    await provider.complete({ prompt: 'hello' });

    expect(lastCall().contents.at(0)?.parts).toHaveLength(1);
  });

  it('supports the method-shaped response text', async () => {
    generateContent.mockResolvedValue({ text: async () => '{"entries":[]}' });
    const provider = new GeminiProvider('test-key', 'gemini-1.5-flash');

    const result = await provider.complete({ prompt: 'hello' });

    expect(result.json).toEqual({ entries: [] });
  });

  it('throws when the model returns malformed JSON', async () => {
    generateContent.mockResolvedValue({ text: 'I could not read that image' });
    const provider = new GeminiProvider('test-key', 'gemini-1.5-flash');

    await expect(provider.complete({ prompt: 'hello' })).rejects.toThrow(/malformed JSON/);
  });

  it('throws when the response carries no text', async () => {
    generateContent.mockResolvedValue({ text: '   ' });
    const provider = new GeminiProvider('test-key', 'gemini-1.5-flash');

    await expect(provider.complete({ prompt: 'hello' })).rejects.toThrow(/empty response/);
  });
});