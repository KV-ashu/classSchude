import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function collector() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, read: () => chunks.join('') };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('structured logger', () => {
  it('writes JSON lines with service, level and fields', async () => {
    const { stream, read } = collector();

    createLogger(stream).info({ count: 2 }, 'processed');
    await flush();

    const entry = JSON.parse(read()) as Record<string, unknown>;
    expect(entry['level']).toBe('info');
    expect(entry['service']).toBe('classsync-server');
    expect(entry['count']).toBe(2);
    expect(entry['msg']).toBe('processed');
  });

  it('redacts credentials, tokens and raw message bodies', async () => {
    const { stream, read } = collector();

    createLogger(stream).info(
      {
        password: 'hunter2',
        token: 'jwt-abc',
        rawText: 'kal DBMS cancel hai',
        nested: { passwordHash: 'scrypt$salt$hash' },
        keep: 'visible',
      },
      'ingest',
    );
    await flush();

    const output = read();
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('jwt-abc');
    expect(output).not.toContain('kal DBMS cancel hai');
    expect(output).not.toContain('scrypt$salt$hash');
    expect(output).toContain('[redacted]');
    expect(output).toContain('visible');
  });
});