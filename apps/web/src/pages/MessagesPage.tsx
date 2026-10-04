import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui';
import { useLiveEvents } from '../context/SocketContext';
import { api, type MessageDto } from '../lib/api';
import { relativeTime, statusTone } from '../lib/format';

export function MessagesPage() {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [manualText, setManualText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<MessageDto[]>('/api/messages?limit=50')
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  useLiveEvents(['message:received', 'message:processed'], load);

  async function send(path: string, body: unknown): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await api.post(path, body);
      setNotice('Message ingested - watch the schedule update live.');
      load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Messages</h1>
        <p className="mt-1 text-sm text-slate-500">
          Drive the ingestion pipeline: replay the scripted WhatsApp scenario or type your own.
        </p>
      </header>

      <Card title="Demo simulator">
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void send('/api/messages/simulate', { mode: 'next' })}>
            Send next simulated message
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void send('/api/messages/simulate', { mode: 'all' })}
          >
            Replay all
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void send('/api/messages/simulate', { mode: 'reset' })}
          >
            Reset scenario
          </Button>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <textarea
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder="e.g. kal DBMS cancel hai"
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <Button
            className="mt-2"
            disabled={busy || manualText.trim().length === 0}
            onClick={() =>
              void send('/api/messages/manual', {
                text: manualText,
                senderName: 'You',
                process: true,
              }).then(() => setManualText(''))
            }
          >
            Send &amp; process
          </Button>
        </div>

        {notice && <p className="mt-3 text-sm text-slate-500">{notice}</p>}
      </Card>

      <Card title="Ingestion history">
        {loading && messages.length === 0 ? (
          <Spinner label="Loading messages..." />
        ) : messages.length === 0 ? (
          <EmptyState title="No messages yet" description="Try the simulator above." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {messages.map((message) => (
              <li key={message.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">{message.rawText}</p>
                  <p className="text-xs text-slate-500">
                    {message.senderName ?? 'unknown'} · {message.sourceKind} ·{' '}
                    {relativeTime(message.timestamp)}
                  </p>
                </div>
                <Badge tone={statusTone(message.status)}>{message.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
