import type { EmitMessageEvent, MessageEvent, MessageSourceAdapter } from '@classsync/shared';
import { ApiError } from '../../errors';

export interface ManualMessageInput {
  rawText: string;
  senderName?: string;
  groupName?: string;
  /** ISO string or Date; defaults to "now". */
  timestamp?: Date | string;
  externalId?: string;
}

/**
 * Adapter for messages a user types or pastes in by hand.
 * Registered through the shared MessageSourceAdapter contract like every other source.
 */
export class ManualMessageAdapter implements MessageSourceAdapter {
  readonly id = 'manual:rest';
  readonly kind = 'manual' as const;

  private emit: EmitMessageEvent | undefined;

  start(emit: EmitMessageEvent): Promise<void> {
    this.emit = emit;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.emit = undefined;
    return Promise.resolve();
  }

  /** Builds the canonical event without emitting it. */
  buildEvent(input: ManualMessageInput): MessageEvent {
    return {
      sourceId: this.id,
      sourceKind: this.kind,
      externalId: input.externalId,
      timestamp: input.timestamp === undefined ? new Date() : new Date(input.timestamp),
      rawText: input.rawText.trim(),
      senderName: input.senderName?.trim() || undefined,
      groupName: input.groupName?.trim() || undefined,
    };
  }

  /** Builds the event and hands it to the pipeline through the registered emitter. */
  publish(input: ManualMessageInput): MessageEvent {
    if (!this.emit) {
      throw ApiError.serviceUnavailable('Manual message adapter is not started');
    }

    const event = this.buildEvent(input);
    this.emit(event);
    return event;
  }
}