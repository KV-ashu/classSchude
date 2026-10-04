import type { ClientToServerEvents, ServerToClientEvents } from '@classsync/shared';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Types } from 'mongoose';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StubProvider } from '../llm/stub.provider';
import { processRawMessage } from '../messages/processing/processor';
import { ingestMessage } from '../messages/ingestion.service';
import { useTestDatabase } from '../test-utils/db';
import { app, buildTestEvent, seedTimetableAccount } from '../test-utils/seed';
import { attachSocketServer, resetSocketServer } from './socket';

useTestDatabase('classsync_test_socket');

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

describe('Socket.IO real-time layer', () => {
  const httpServer = createServer(app);
  let baseUrl = '';
  let client: TestClient | undefined;

  beforeAll(async () => {
    attachSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    client?.close();
    resetSocketServer();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('refuses connections without a valid token', async () => {
    const error = await new Promise<Error>((resolve) => {
      const socket = io(baseUrl, { transports: ['websocket'], reconnection: false });
      socket.on('connect_error', (connectError) => {
        socket.close();
        resolve(connectError as Error);
      });
    });

    expect(error.message).toBe('UNAUTHORIZED');
  });

  it('pushes schedule.cancelled to the owner when a change auto-applies', async () => {
    const account = await seedTimetableAccount();
    const socketClient: TestClient = io(baseUrl, {
      auth: { token: account.token },
      transports: ['websocket'],
      reconnection: false,
    });
    client = socketClient;
    await new Promise<void>((resolve) => {
      socketClient.on('connect', () => resolve());
    });

    const { userId, event } = buildTestEvent(account.userId, 'DBMS class cancelled today');
    const { message } = await ingestMessage(new Types.ObjectId(userId), event);

    const received = new Promise<string>((resolve) => {
      socketClient.on('schedule.cancelled', (payload) => resolve(payload.action ?? 'unknown'));
    });

    await processRawMessage(message.id, {
      provider: new StubProvider({
        changes: [
          {
            action: 'CANCEL',
            courseText: 'DBMS',
            dateExpression: 'today',
            isAmbiguous: false,
            certainty: 0.97,
            reason: 'clear cancellation',
          },
        ],
      }),
    });

    expect(await received).toBe('CANCEL');
  });
});