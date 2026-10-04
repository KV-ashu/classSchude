import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLiveEvents } from '../context/SocketContext';
import { api, type EffectiveDay, type EffectiveEntry } from '../lib/api';
import {
  dayShort,
  formatDateLabel,
  formatTimeRange,
  isoDateInZone,
  isoWeekday,
  shiftIsoDate,
  statusTone,
} from '../lib/format';

function EntryRow({ entry }: { entry: EffectiveEntry }) {
  const cancelled = entry.status === 'CANCELLED';

  return (
    <li
      className={`rounded-lg border-l-4 bg-white p-3 shadow-sm ${
        cancelled
          ? 'border-l-rose-400 opacity-70'
          : entry.changed
            ? 'border-l-indigo-500'
            : 'border-l-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-sm font-semibold text-slate-900 ${cancelled ? 'line-through' : ''}`}
        >
          {entry.courseCode} · {entry.courseName}
        </p>
        <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {entry.previousStartTime ? (
          <span className="font-medium text-indigo-600">
            <span className="line-through text-slate-400">{entry.previousStartTime}</span> →{' '}
            {formatTimeRange(entry.startTime, entry.endTime)}
          </span>
        ) : (
          formatTimeRange(entry.startTime, entry.endTime)
        )}
        {entry.room ? ` · ${entry.room}` : ''} · {entry.kind.toLowerCase()}
      </p>
    </li>
  );
}

export function TimetablePage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Asia/Kolkata';
  const today = isoDateInZone(timezone);
  const [mode, setMode] = useState<'week' | 'day'>('week');
  const [selected, setSelected] = useState(today);
  const [days, setDays] = useState<EffectiveDay[]>([]);
  const [loading, setLoading] = useState(true);

  const weekDays = useMemo(() => {
    const monday = shiftIsoDate(today, -(isoWeekday(today) - 1));
    return [0, 1, 2, 3, 4, 5, 6].map((offset) => shiftIsoDate(monday, offset));
  }, [today]);

  const load = useCallback(() => {
    setLoading(true);
    const dates = mode === 'day' ? [selected] : weekDays;
    Promise.all(dates.map((date) => api.get<EffectiveDay>(`/api/changes/effective?date=${date}`)))
      .then(setDays)
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [mode, selected, weekDays]);

  useEffect(load, [load]);
  useLiveEvents(
    ['schedule.updated', 'schedule.cancelled', 'review.resolved', 'change.reverted'],
    load,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Timetable</h1>
          <p className="mt-1 text-sm text-slate-500">
            Effective schedule — cancellations struck through, reschedules marked.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('week')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'week' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setMode('day')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'day' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Day
          </button>
        </div>
      </header>

      {mode === 'day' && (
        <input
          type="date"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      )}

      {loading && days.length === 0 ? (
        <Spinner label="Loading timetable..." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => (
            <Card key={day.occurrenceDate} title={formatDateLabel(day.occurrenceDate)}>
              {day.entries.length === 0 ? (
                <EmptyState title={`No classes on ${dayShort(isoWeekday(day.occurrenceDate))}`} />
              ) : (
                <ul className="space-y-2">
                  {day.entries.map((entry) => (
                    <EntryRow key={entry.entryId} entry={entry} />
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
