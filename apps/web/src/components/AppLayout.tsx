import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLive, useLiveEvents } from '../context/SocketContext';
import { api, type ScheduleChangeDto } from '../lib/api';
import { Button } from './ui';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/timetable', label: 'Timetable' },
  { to: '/review', label: 'Review' },
  { to: '/messages', label: 'Messages' },
  { to: '/changes', label: 'Changes' },
] as const;

export function AppLayout() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const [pending, setPending] = useState(0);

  const loadPending = useCallback(() => {
    api
      .get<ScheduleChangeDto[]>('/api/changes?status=PENDING_REVIEW')
      .then((changes) => setPending(changes.length))
      .catch(() => setPending(0));
  }, []);

  useEffect(loadPending, [loadPending]);
  useLiveEvents(['review.resolved', 'schedule.reviewRequired'], loadPending);

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-lg font-semibold tracking-tight text-slate-900">ClassSync</p>
            <p className="text-xs text-slate-500">Schedule assistant</p>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  ].join(' ')
                }
              >
                {item.label}
                {item.to === '/review' && pending > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {pending}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="space-y-3 border-t border-slate-200 p-4">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <span
                className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`}
              />
              {connected ? 'Live updates on' : 'Reconnecting...'}
            </p>
            <p className="truncate text-xs text-slate-500">{user?.displayName}</p>
            <Button variant="ghost" onClick={logout} className="w-full">
              Sign out
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
            <p className="text-base font-semibold text-slate-900">ClassSync</p>
            <div className="flex items-center gap-3">
              {pending > 0 && (
                <NavLink
                  to="/review"
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
                >
                  {pending} to review
                </NavLink>
              )}
              <Button variant="ghost" onClick={logout} className="px-2 py-1 text-xs">
                Sign out
              </Button>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">
            <Outlet />
          </main>

          <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-slate-200 bg-white py-1 md:hidden">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'relative rounded-md px-2 py-1.5 text-xs font-medium',
                    isActive ? 'text-indigo-700' : 'text-slate-500',
                  ].join(' ')
                }
              >
                {item.label}
                {item.to === '/review' && pending > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
