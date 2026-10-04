import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui';
import { useLiveEvents } from '../context/SocketContext';
import { api, type MessageDto, type ScheduleChangeDto } from '../lib/api';
import { relativeTime } from '../lib/format';

interface Draft {
  room: string;
  startTime: string;
  endTime: string;
}

export function ReviewPage() {
  const [queue, setQueue] = useState<ScheduleChangeDto[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<ScheduleChangeDto[]>('/api/changes?status=PENDING_REVIEW')
      .then(async (changes) => {
        setQueue(changes);
        const texts = await Promise.all(
          changes.map((change) =>
            api
              .get<MessageDto>(`/api/messages/${change.rawMessageId}`)
              .then((message) => [change.rawMessageId, message.rawText] as const)
              .catch(() => [change.rawMessageId, '(message unavailable)'] as const),
          ),
        );
        setSources(Object.fromEntries(texts));
      })
      .catch(() => setQueue([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  useLiveEvents(['schedule.reviewRequired', 'review.resolved', 'message:processed'], load);

  function draftFor(change: ScheduleChangeDto): Draft {
    const existing = drafts[change.id];
    if (existing) {
      return existing;
    }
    return {
      room: change.newValue?.room ?? change.oldValue?.room ?? '',
      startTime: change.newValue?.startTime ?? change.oldValue?.startTime ?? '',
      endTime: change.newValue?.endTime ?? change.oldValue?.endTime ?? '',
    };
  }

  function updateDraft(changeId: string, patch: Partial<Draft>): void {
    setDrafts((current) => {
      const existing: Draft = current[changeId] ?? { room: '', startTime: '', endTime: '' };
      return { ...current, [changeId]: { ...existing, ...patch } };
    });
  }

  async function decide(change: ScheduleChangeDto, action: 'approve' | 'reject'): Promise<void> {
    setBusyId(change.id);
    setError(null);
    try {
      const draft = draftFor(change);
      if (action === 'approve') {
        await api.post(`/api/changes/${change.id}/approve`, draft);
      } else {
        await api.post(`/api/changes/${change.id}/reject`, { reason: 'rejected from the UI' });
      }
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Review queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Uncertain extractions land here instead of touching your timetable. Edit, approve or
          reject.
        </p>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {loading && queue.length === 0 ? (
        <Spinner label="Loading queue..." />
      ) : queue.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          description="Ambiguous messages (for example 'I think DBMS is cancelled') show up here."
        />
      ) : (
        <div className="space-y-4">
          {queue.map((change) => {
            const draft = draftFor(change);
            return (
              <Card key={change.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {change.action.replace('_', ' ')} · {change.occurrenceDate}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      confidence {change.confidence.toFixed(2)} · proposed{' '}
                      {relativeTime(change.createdAt)}
                    </p>
                  </div>
                  <Badge tone="warning">{change.status}</Badge>
                </div>

                <blockquote className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm italic text-slate-600">
                  “{sources[change.rawMessageId] ?? 'loading message...'}”
                </blockquote>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      { key: 'startTime', label: 'Start', type: 'time' },
                      { key: 'endTime', label: 'End', type: 'time' },
                      { key: 'room', label: 'Room', type: 'text' },
                    ] as const
                  ).map((field) => (
                    <label key={field.key} className="text-xs font-medium text-slate-600">
                      {field.label}
                      <input
                        type={field.type}
                        value={draft[field.key]}
                        onChange={(event) =>
                          updateDraft(change.id, { [field.key]: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    onClick={() => void decide(change, 'approve')}
                    disabled={busyId === change.id}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void decide(change, 'reject')}
                    disabled={busyId === change.id}
                  >
                    Reject
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
