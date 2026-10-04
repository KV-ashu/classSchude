import { messageEventSchema, type EmitMessageEvent, type MessageEvent } from '@classsync/shared';
import { enqueueMessageEvent } from '../pipeline-queue';
import { ManualMessageAdapter } from './manual.adapter';
import { SimulationAdapter } from './simulation.adapter';

export { ManualMessageAdapter } from './manual.adapter';
export { SimulationAdapter } from './simulation.adapter';
export { SIMULATION_MESSAGES, type SimulatedMessage } from './simulation.scenario';

/**
 * Holds every MessageSourceAdapter implementation in the process and wires their
 * push channel to the ingestion queue. The pipeline itself never learns which
 * adapter a message came from.
 */
export class MessageAdapterRegistry {
  readonly manual = new ManualMessageAdapter();
  readonly simulation = new SimulationAdapter();

  private started: Promise<void> | undefined;

  async start(): Promise<void> {
    await this.manual.start(this.handleEvent);
    await this.simulation.start(this.handleEvent);
  }

  /** Idempotent start - routes call this so they never depend on boot order. */
  async ensureStarted(): Promise<void> {
    this.started ??= this.start();
    await this.started;
  }

  async stop(): Promise<void> {
    await this.manual.stop();
    await this.simulation.stop();
    this.started = undefined;
  }

  /** Push channel every adapter emits into. */
  private handleEvent = (event: MessageEvent): void => {
    // Contract enforced at the boundary: only valid events reach the pipeline.
    enqueueMessageEvent(messageEventSchema.parse(event));
  };
}

export const messageAdapters = new MessageAdapterRegistry();
export type { EmitMessageEvent };