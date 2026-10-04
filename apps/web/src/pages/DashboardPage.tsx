import { CONFIDENCE_THRESHOLDS } from '@classsync/shared';
import { useEffect, useState } from 'react';
import { EmptyStateCard } from '../components/EmptyStateCard';

interface ServerHealth {
  ok: boolean;
  service: string;
  uptimeSeconds: number;
}

type HealthState =
  | { status: 'checking' }
  | { status: 'online'; health: ServerHealth }
  | { status: 'offline'; reason: string };

export function DashboardPage() {
  const [health, setHealth] = useState<HealthState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;

    async function checkHealth(): Promise<void> {
      try {
        const response = await fetch('/api/health');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = (await response.json()) as ServerHealth;
        if (!cancelled) {
          setHealth({ status: 'online', health: body });
        }
      } catch (error) {
        if (!cancelled) {
          setHealth({
            status: 'offline',
            reason: error instanceof Error ? error.message : 'unreachable',
          });
        }
      }
    }

    void checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Today&apos;s effective schedule will appear here once the baseline timetable (Phase 3)
          and the change pipeline (Phases 5-6) are in place.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700">API status</h2>
          <div className="mt-2">
            {health.status === 'checking' && <p className="text-sm text-slate-500">Checking...</p>}
            {health.status === 'online' && (
              <p className="text-sm text-emerald-700">
                Server online - up {health.health.uptimeSeconds}s
              </p>
            )}
            {health.status === 'offline' && (
              <p className="text-sm text-rose-600">Server offline ({health.reason})</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700">Confidence policy</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-500">
            <li>&ge; {CONFIDENCE_THRESHOLDS.AUTO_APPLY.toFixed(2)} - auto-applied</li>
            <li>
              {CONFIDENCE_THRESHOLDS.REVIEW.toFixed(2)} &ndash;{' '}
              {CONFIDENCE_THRESHOLDS.AUTO_APPLY.toFixed(2)} - queued for review
            </li>
            <li>&lt; {CONFIDENCE_THRESHOLDS.REVIEW.toFixed(2)} - rejected</li>
          </ul>
        </div>
      </section>

      <EmptyStateCard title="Today's schedule" phase="Phase 3+">
        No baseline timetable yet. Import one in Phase 3 and today&apos;s effective classes
        (including cancellations and reschedules) will render here.
      </EmptyStateCard>
    </div>
  );
}
