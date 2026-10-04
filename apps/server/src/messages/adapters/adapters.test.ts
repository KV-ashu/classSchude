import { messageEventSchema, type MessageSourceAdapter } from '@classsync/shared';
import { describe, expect, it } from 'vitest';
import {
  clearMessageEventQueue,
  drainMessageEvents,
  enqueueMessageEvent,
  pendingMessageEventCount,
} from '../pipeline-queue';
import { ManualMessageAdapter } from './manual.adapter';
import { SIMULATION_MESSAGES } from './simulation.scenario';
import { SimulationAdapter } from './simulation.adapter';

// Compile-time proof that both adapters satisfy the shared contract.
const manualAsContract: MessageSourceAdapter = new ManualMessageAdapter();
const simulationAsContract: MessageSourceAdapter = new SimulationAdapter();

const FIXED_NOW = new Date('2026-03-10T10:00:00.000Z');

describe('MessageSourceAdapter contract', () => {
  it('is implemented by both adapters (id, kind, start, stop)', () => {
    expect(manualAsContract.kind).toBe('manual');
    expect(manualAsContract.id.length).toBeGreaterThan(0);
    expect(typeof manualAsContract.start).toBe('function');
    expect(typeof manualAsContract.stop).toBe('function');
    expect(simulationAsContract.kind).toBe('simulator');
    expect(typeof simulationAsContract.start).toBe('function');
  });

  it('emits contract-valid events and refuses to publish after stop()', async () => {
    const adapter = new ManualMessageAdapter();
    const emitted: unknown[] = [];
    await adapter.start((event) => emitted.push(event));

    adapter.publish({ rawText: 'DBMS cancelled', senderName: 'Rahul' });
    expect(messageEventSchema.safeParse(emitted[0]).success).toBe(true);

    await adapter.stop();
    expect(() => adapter.publish({ rawText: 'DBMS cancelled' })).toThrow();
  });
});

describe('ManualMessageAdapter', () => {
  it('trims the text and honours the supplied timestamp', () => {
    const adapter = new ManualMessageAdapter();

    const event = adapter.buildEvent({
      rawText: '  DBMS class cancelled  ',
      senderName: ' Rahu ',
      groupName: 'CSE-3A',
      timestamp: '2026-03-10T09:15:00+05:30',
    });

    expect(event.rawText).toBe('DBMS class cancelled');
    expect(event.senderName).toBe('Rahu');
    expect(event.sourceKind).toBe('manual');
    expect(event.timestamp.toISOString()).toBe('2026-03-10T03:45:00.000Z');
  });
});

describe('SimulationAdapter scenario', () => {
  it('ships at least 20 unique messages', () => {
    expect(SIMULATION_MESSAGES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SIMULATION_MESSAGES.map((message) => message.text)).size).toBe(
      SIMULATION_MESSAGES.length,
    );
  });

  it('covers cancellations, shifts, rooms, Hinglish, typos, ambiguity and chatter', () => {
    const all = SIMULATION_MESSAGES.map((message) => message.text.toLowerCase()).join(' | ');

    expect(all).toContain('cancel');
    expect(all).toMatch(/kal|aaj|today|tomorrow/);
    expect(all).toContain('shifted');
    expect(all).toContain('room changed');
    expect(all).toMatch(/hai|rahenge|ki classes/);
    expect(all).toContain('dbs'); // typo that only an alias match can rescue
    expect(all).toContain('i think'); // ambiguous - must not auto-apply
    expect(all).toContain('notes'); // chatter - must never become a change
  });

  it('anchors timestamps to the adapter clock, not the server clock', () => {
    const adapter = new SimulationAdapter(SIMULATION_MESSAGES, () => FIXED_NOW);
    const message = SIMULATION_MESSAGES.at(0);
    if (!message) {
      throw new Error('scenario is empty');
    }

    const event = adapter.buildEvent(message, 0);

    expect(event.timestamp.toISOString()).toBe(
      new Date(FIXED_NOW.getTime() - message.minutesAgo * 60_000).toISOString(),
    );
    expect(event.externalId).toBe('sim-1');
  });

  it('replays in order and stops at the end until reset', async () => {
    const adapter = new SimulationAdapter(SIMULATION_MESSAGES, () => FIXED_NOW);
    const emitted: unknown[] = [];
    await adapter.start((event) => emitted.push(event));

    const first = adapter.publishNext();
    const second = adapter.publishNext();
    expect(first.externalId).toBe('sim-1');
    expect(second.externalId).toBe('sim-2');
    expect(emitted).toHaveLength(2);
    expect(adapter.remaining).toBe(SIMULATION_MESSAGES.length - 2);

    adapter.publishRemaining();
    expect(adapter.remaining).toBe(0);
    expect(() => adapter.publishNext()).toThrow(/exhausted/);

    adapter.reset();
    expect(adapter.remaining).toBe(SIMULATION_MESSAGES.length);
    // Replaying after a reset is byte-identical, which keeps dedup meaningful.
    expect(adapter.publishNext().timestamp.toISOString()).toBe(first.timestamp.toISOString());
  });
});

describe('pipeline queue', () => {
  it('accepts adapter events and drains them FIFO', () => {
    clearMessageEventQueue();
    const adapter = new ManualMessageAdapter();
    const event = adapter.buildEvent({ rawText: 'DBMS cancelled' });

    enqueueMessageEvent(event);
    enqueueMessageEvent(event);

    expect(pendingMessageEventCount()).toBe(2);
    expect(drainMessageEvents()).toHaveLength(2);
    expect(pendingMessageEventCount()).toBe(0);
  });
});