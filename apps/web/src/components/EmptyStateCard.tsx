import type { ReactNode } from 'react';

interface EmptyStateCardProps {
  title: string;
  /** Which future phase brings this feature - keeps placeholders honest. */
  phase: string;
  children: ReactNode;
}

/** Placeholder card used until a view is functionally implemented. */
export function EmptyStateCard({ title, phase, children }: EmptyStateCardProps) {
  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {phase}
        </span>
      </div>
      <div className="mt-2 text-sm leading-relaxed text-slate-500">{children}</div>
    </section>
  );
}
