import { EmptyStateCard } from '../components/EmptyStateCard';

const STATUS_CHIPS = ['Scheduled', 'Cancelled', 'Rescheduled', 'Room changed', 'Online'] as const;

export function TimetablePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Timetable</h1>
        <p className="mt-1 text-sm text-slate-500">
          Weekly and daily views of the effective timetable, with per-entry status.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        {STATUS_CHIPS.map((label) => (
          <span
            key={label}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-500"
          >
            {label}
          </span>
        ))}
      </div>

      <EmptyStateCard title="Week grid" phase="Phase 3 + 5">
        The baseline timetable is imported and locked in Phase 3. The effective view (baseline +
        applied changes, with conflict flags) is computed in Phase 5 and rendered here.
      </EmptyStateCard>
    </div>
  );
}
