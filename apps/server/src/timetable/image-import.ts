import { TIMETABLE_ENTRY_KINDS } from '@classsync/shared';
import { z } from 'zod';
import { ApiError } from '../errors';
import type { LlmCompletionResult, LlmProvider } from '../llm/types';
import { VISION_PROMPT_VERSION, VISION_SYSTEM_INSTRUCTION, buildVisionPrompt } from '../llm/vision';
import {
  timeStringSchema,
  timetableRowSchema,
  type ImportRowError,
  type TimetableRow,
} from './import.schemas';

/** Structure we demand from the vision model. Anything else is rejected. */
export const visionExtractionSchema = z.object({
  entries: z
    .array(
      z.object({
        courseCode: z.string().trim().max(40).optional(),
        courseName: z.string().trim().max(120).optional(),
        day: z.coerce.number().int().min(1).max(7),
        startTime: timeStringSchema,
        endTime: timeStringSchema,
        room: z.string().trim().max(40).optional(),
        kind: z.enum(TIMETABLE_ENTRY_KINDS).default('LECTURE'),
      }),
    )
    .max(60),
});

export interface VisionExtractionResult {
  rows: TimetableRow[];
  errors: ImportRowError[];
  model: string;
  promptVersion: string;
}

/** Removes an optional `data:image/png;base64,` prefix from an upload. */
export function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

/**
 * Runs the multimodal extraction: LLM -> Zod -> canonical rows.
 * Errors are collected per entry so the user can fix them during review
 * instead of losing the whole image.
 */
export async function extractTimetableFromImage(
  provider: LlmProvider,
  image: { base64: string; mimeType: string },
): Promise<VisionExtractionResult> {
  let completion: LlmCompletionResult;
  try {
    completion = await provider.complete({
      prompt: buildVisionPrompt(),
      systemInstruction: VISION_SYSTEM_INSTRUCTION,
      image,
    });
  } catch (error) {
    throw ApiError.serviceUnavailable(
      `Timetable image extraction failed: ${error instanceof Error ? error.message : 'LLM error'}`,
    );
  }

  const parsed = visionExtractionSchema.safeParse(completion.json);
  if (!parsed.success) {
    throw ApiError.unprocessable('Gemini returned an unexpected timetable structure', {
      issues: parsed.error.issues,
    });
  }

  const rows: TimetableRow[] = [];
  const errors: ImportRowError[] = [];

  parsed.data.entries.forEach((entry, index) => {
    const courseCode = entry.courseCode ?? entry.courseName;
    if (!courseCode) {
      errors.push({
        row: index + 1,
        field: 'courseCode',
        message: 'entry has no course code or name',
        raw: entry,
      });
      return;
    }

    const result = timetableRowSchema.safeParse({
      courseCode,
      day: entry.day,
      startTime: entry.startTime,
      endTime: entry.endTime,
      room: entry.room,
      kind: entry.kind,
    });

    if (result.success) {
      rows.push(result.data);
      return;
    }

    const issue = result.error.issues[0];
    errors.push({
      row: index + 1,
      field: issue?.path.join('.'),
      message: issue?.message ?? 'invalid entry',
      raw: entry,
    });
  });

  return { rows, errors, model: completion.model, promptVersion: VISION_PROMPT_VERSION };
}