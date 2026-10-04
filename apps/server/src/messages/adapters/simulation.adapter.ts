import type { EmitMessageEvent, MessageEvent, MessageSourceAdapter } from '@classsync/shared';
import { ApiError } from '../../errors';
import { SIMULATION_MESSAGES, type SimulatedMessage } from './simulation.scenario';

/**
 * Adapter that replays a scripted WhatsApp-group conversation.
 *
 * Every message gets its own external id and a realistic "sent N minutes ago"
 * timestamp, which is exactly the value the Phase 5 pipeline must resolve
 * relative dates against (never the server's current time).
 */
export class SimulationAdapter implements MessageSourceAdapter {
  readonly id = 'sim:whatsapp-cse3a';
  readonly kind = 'simulator' as const;

  private emit: EmitMessageEvent | undefined;
  private cursor = 0;
  /** Fixed anchor so replaying the scenario produces identical timestamps. */
  private readonly anchor: Date;

  constructor(
    private readonly scenario: readonly SimulatedMessage[] = SIMULATION_MESSAGES,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.anchor = this.now();
  }

  start(emit: EmitMessageEvent): Promise<void> {
    this.emit = emit;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.emit = undefined;
    return Promise.resolve();
  }

  get total(): number {
    return this.scenario.length;
  }

  get remaining(): number {
    return Math.max(0, this.scenario.length - this.cursor);
  }

  list(): readonly SimulatedMessage[] {
    return this.scenario;
  }

  peek(index: number): SimulatedMessage {
    const message = this.scenario[index];
    if (!message) {
      throw ApiError.notFound(`No simulated message at index ${index}`);
    }
    return message;
  }

  buildEvent(message: SimulatedMessage, index: number): MessageEvent {
    return {
      sourceId: this.id,
      sourceKind: this.kind,
      externalId: `sim-${index + 1}`,
      timestamp: new Date(this.anchor.getTime() - message.minutesAgo * 60_000),
      rawText: message.text,
      senderName: message.senderName,
      groupName: message.groupName,
    };
  }

  /** Emits one scripted message without moving the cursor. */
  publishIndex(index: number): MessageEvent {
    if (!this.emit) {
      throw ApiError.serviceUnavailable('Simulation adapter is not started');
    }
    const event = this.buildEvent(this.peek(index), index);
    this.emit(event);
    return event;
  }

  publishNext(): MessageEvent {
    if (this.remaining === 0) {
      throw ApiError.conflict('Simulation scenario is exhausted - reset it before replaying');
    }
    const event = this.publishIndex(this.cursor);
    this.cursor += 1;
    return event;
  }

  publishRemaining(): MessageEvent[] {
    const events: MessageEvent[] = [];
    while (this.remaining > 0) {
      events.push(this.publishNext());
    }
    return events;
  }

  reset(): void {
    this.cursor = 0;
  }
}