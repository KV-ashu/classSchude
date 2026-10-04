import { EmptyStateCard } from '../components/EmptyStateCard';

export function ChangesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Changes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Audit log of every schedule change - what the AI or you changed, why, and how to revert
          it.
        </p>
      </header>

      <EmptyStateCard title="No changes recorded" phase="Phase 5">
        The baseline timetable is immutable; every mutation is a reversible ScheduleChange with an
        immutable AuditLog entry. Reverting restores the previous state without deleting history.
      </EmptyStateCard>
    </div>
  );
}
