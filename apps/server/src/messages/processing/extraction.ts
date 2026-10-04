import { DateTime } from 'luxon';
import type { LlmProvider } from '../../llm/types';
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM_INSTRUCTION,
  buildExtractionPrompt,
  buildRepairPrompt,
} from './extraction.prompt';
import {
  ExtractionError,
  extractionResultSchema,
  type ExtractionResult,
} from './extraction.schemas';
import type { CourseHint } from './course-matching';

export interface ExtractionContext {
  rawText: string;
  /** Message timestamp - relative dates must be resolved against this. */
  timestamp: Date;
  timezone: string;
  courses: CourseHint[];
}

export interface ExtractionOutcome {
  result: ExtractionResult;
  promptVersion: string;
  model: string;
  latencyMs: number;
  /** True when the first response violated the schema and had to be repaired. */
  repaired: boolean;
}

/**
 * One LLM call (plus at most one repair pass) that turns a message into
 * schema-validated drafts. Never throws raw provider errors upward: a
 * non-repairable response becomes an ExtractionError the processor records as
 * a FAILED message instead of crashing the pipeline.
 */
export async function extractScheduleChanges(
  provider: LlmProvider,
  context: ExtractionContext,
): Promise<ExtractionOutcome> {
  const messageLocalTime =
    DateTime.fromJSDate(context.timestamp, { zone: context.timezone }).toISO() ??
    context.timestamp.toISOString();

  const prompt = buildExtractionPrompt({
    rawText: context.rawText,
    messageLocalTime,
    timezone: context.timezone,
    courses: context.courses,
  });

  const first = await provider.complete({
    prompt,
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
  });

  const parsed = extractionResultSchema.safeParse(first.json);
  if (parsed.success) {
    return {
      result: parsed.data,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      model: first.model,
      latencyMs: first.latencyMs,
      repaired: false,
    };
  }

  const repair = await provider.complete({
    prompt: buildRepairPrompt(JSON.stringify(first.json), parsed.error.issues),
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
  });

  const repaired = extractionResultSchema.safeParse(repair.json);
  if (repaired.success) {
    return {
      result: repaired.data,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      model: repair.model,
      latencyMs: first.latencyMs + repair.latencyMs,
      repaired: true,
    };
  }

  throw new ExtractionError('LLM output did not match the extraction schema', repaired.error.issues);
}