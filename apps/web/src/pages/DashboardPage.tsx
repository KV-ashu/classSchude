import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, Spinner, StatCard } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLiveEvents } from '../context/SocketContext';
import { api, type EffectiveDay, type ScheduleChangeDto } from '../lib/api';
import {
  formatDateLabel,
  formatTimeRange,
  isoDateInZone,
  relativeTime,
  statusTone,
} from '../lib/format';

export function DashboardPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Kolkata';
  const today = isoDateInZone(timezone);

  const [day, setDay] = useState<EffectiveDay | null>(null);
  const [recent, setRecent] = useState<ScheduleChangeDto[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<EffectiveDay>(`/api/changes/effective?date=${today}`),
      api.get<ScheduleChangeDto[]>('/api/changes?limit=6'),
      api.get<ScheduleChangeDto[]>('/api/changes?status=PENDING_REVIEW'),
    ])
      .then(([effective, changes, queue]) => {
        setDay(effective);
        setRecent(changes);
        setPending(queue.length);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [today]);

  useEffect(load, [load]);
  useLiveEvents(
    [
      'schedule.updated',
      'schedule.cancelled',
      'schedule.reviewRequired',
      'review.resolved',
      'change.reverted',
      'message:processed',
    ],
    load,
  );

  const entries = day?.entries ?? [];
  const cancelled = entries.filter((entry) => entry.status === 'CANCELLED').length;
  const nextClass = entries.find((entry) => entry.status !== 'CANCELLED');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          {formatDateLabel(today)} · effective timetable, updated live.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Classes today" value={entries.length} hint="baseline + applied changes" />
        <StatCard label="Cancelled" value={cancelled} hint="struck through below" />
        <StatCard label="Pending reviews" value={pending} hint="waiting for you" />
      </section>

      {loading && entries.length === 0 ? (
        <Spinner label="Loading today's schedule..." />
      ) : (
        <Card title="Next class">
          {nextClass ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  {nextClass.courseCode} · {nextClass.courseName}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {formatTimeRange(nextClass.startTime, nextClass.endTime)}
                  {nextClass.room ? ` · ${nextClass.room}` : ''}
                </p>
              </div>
              <Badge tone={nextClass.status === 'ONLINE' ? 'warning' : 'info'}>
                {nextClass.status === 'ONLINE' ? 'Online' : 'Scheduled'}
              </Badge>
            </div>
          ) : (
            <EmptyState
              title="No classes scheduled today"
              description="Import a timetable or replay a simulated message to see changes here."
            />
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Today's schedule">
          {entries.length === 0 ? (
            <EmptyState title="Nothing scheduled" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <li key={entry.entryId} className="flex items-center justify-between gap-3 py-2">
                  <div className={entry.status === 'CANCELLED' ? 'opacity-60' : ''}>
                    <p
                      className={`text-sm font-medium text-slate-800 ${entry.status === 'CANCELLED' ? 'line-through' : ''}`}
                    >
                      {entry.courseCode} · {entry.courseName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {entry.previousStartTime ? (
                        <>
                          <span className="line-through">{entry.previousStartTime}</span>{' '}
                          <span className="font-medium text-indigo-600">{entry.startTime}</span>
                        </>
                      ) : (
                        formatTimeRange(entry.startTime, entry.endTime)
                      )}
                      {entry.room ? ` · ${entry.room}` : ''}
                    </p>
                  </div>
                  <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent changes"
          action={
            pending > 0 ? (
              <Link to="/review" className="text-xs font-medium text-indigo-600 hover:underline">
                Review {pending}
              </Link>
            ) : undefined
          }
        >
          {recent.length === 0 ? (
            <EmptyState title="No changes yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((change) => (
                <li key={change.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {change.action.replace('_', ' ')} · {change.occurrenceDate}
                    </p>
                    <p className="text-xs text-slate-500">
                      confidence {change.confidence.toFixed(2)} · {relativeTime(change.createdAt)}
                    </p>
                  </div>
                  <Badge tone={statusTone(change.status)}>{change.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
