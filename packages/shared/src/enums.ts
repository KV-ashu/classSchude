import { z } from 'zod';

/** Actions the extraction pipeline can recognise in a message. */
export const SCHEDULE_CHANGE_ACTIONS = [
  'CANCEL',
  'RESCHEDULE_TIME',
  'CHANGE_ROOM',
  'MARK_ONLINE',
] as const;
export const scheduleChangeActionSchema = z.enum(SCHEDULE_CHANGE_ACTIONS);
export type ScheduleChangeAction = z.infer<typeof scheduleChangeActionSchema>;

/** Lifecycle status of a ScheduleChange document. */
export const CHANGE_STATUSES = [
  'PENDING_REVIEW',
  'AUTO_APPLIED',
  'APPLIED_MANUALLY',
  'REJECTED',
  'REVERTED',
] as const;
export const changeStatusSchema = z.enum(CHANGE_STATUSES);
export type ChangeStatus = z.infer<typeof changeStatusSchema>;

/** Where a RawMessage came from (one per MessageSourceAdapter kind). */
export const MESSAGE_SOURCE_KINDS = ['manual', 'simulator', 'android-scraper'] as const;
export const messageSourceKindSchema = z.enum(MESSAGE_SOURCE_KINDS);
export type MessageSourceKind = z.infer<typeof messageSourceKindSchema>;

/** Processing state machine of a RawMessage as it moves through the pipeline. */
export const PIPELINE_STATUSES = [
  'RECEIVED',
  'NORMALIZED',
  'CLASSIFIED',
  'EXTRACTING',
  'VALIDATED',
  'APPLIED',
  'QUEUED',
  'REJECTED',
  'IGNORED',
  'FAILED',
] as const;
export const pipelineStatusSchema = z.enum(PIPELINE_STATUSES);
export type PipelineStatus = z.infer<typeof pipelineStatusSchema>;
