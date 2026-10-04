import type { SocketEventName } from '@classsync/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createAppSocket, type AppSocket } from '../lib/socket';
import { useAuth } from './AuthContext';

interface LiveContextValue {
  socket: AppSocket | null;
  connected: boolean;
}

const LiveContext = createContext<LiveContextValue>({ socket: null, connected: false });

export function LiveProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setConnected(false);
      return;
    }

    const client = createAppSocket(token);
    setSocket(client);

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    client.on('connect', handleConnect);
    client.on('disconnect', handleDisconnect);

    return () => {
      client.off('connect', handleConnect);
      client.off('disconnect', handleDisconnect);
      client.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}

/**
 * Runs `handler` whenever one of the given server events arrives.
 * This is the whole live-update mechanism: every view simply refetches.
 */
export function useLiveEvents(events: SocketEventName[], handler: () => void): void {
  const { socket } = useLive();
  const key = events.join('|');
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) {
      return;
    }
    const names = key.split('|').filter((name): name is SocketEventName => name.length > 0);
    const listener = () => handlerRef.current();

    for (const name of names) {
      socket.on(name, listener);
    }
    return () => {
      for (const name of names) {
        socket.off(name, listener);
      }
    };
  }, [socket, key]);
}