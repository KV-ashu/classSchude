import type { MessageSourceKind } from '../enums';
import type { MessageEvent } from '../schemas/message-event';

/** Callback every adapter uses to hand a normalized message to the ingestion pipeline. */
export type EmitMessageEvent = (event: MessageEvent) => void;

/**
 * Decouples message ingestion from the pipeline.
 *
 * Planned implementations:
 * - `ManualInputAdapter`  - REST endpoint for typing/pasting a message
 * - `SimulatorAdapter`    - demo panel that simulates a WhatsApp group
 * - `AndroidScraperAdapter` - optional, later; never the main product
 *
 * The pipeline must depend only on `MessageEvent`, never on a concrete adapter.
 */
export interface MessageSourceAdapter {
  /** Stable identifier of this adapter instance. */
  readonly id: string;
  readonly kind: MessageSourceKind;
  /** Start producing messages; each one is handed to `emit`. */
  start(emit: EmitMessageEvent): Promise<void>;
  /** Stop producing messages and release any resources. */
  stop(): Promise<void>;
}
