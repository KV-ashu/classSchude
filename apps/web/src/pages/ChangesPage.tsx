import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Spinner } from '../components/ui';
import { useLiveEvents } from '../context/SocketContext';
import { api, type AuditEntryDto } from '../lib/api';
import { relativeTime, statusTone } from '../lib/format';

export function ChangesPage() {
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .get<AuditEntryDto[]>('/api/audit')
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  useLiveEvents(
    ['schedule.updated', 'schedule.cancelled', 'review.resolved', 'change.reverted', 'message:processed'],
    load,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Changes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Append-only audit trail. The baseline is immutable; every mutation is recorded and
          reversible.
        </p>
      </header>

      <Card title="Audit log">
        {loading && entries.length === 0 ? (
          <Spinner label="Loading audit log..." />
        ) : entries.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {entry.action.replace(/_/g, ' ').toLowerCase()}
                    {entry.occurrenceDate ? ` · ${entry.occurrenceDate}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {entry.actor} · {relativeTime(entry.createdAt)}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </p>
                </div>
                <Badge tone={statusTone(entry.action)}>{entry.actor}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
