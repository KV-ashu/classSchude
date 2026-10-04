import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { LiveProvider } from './context/SocketContext';

vi.mock('../lib/socket', () => ({
  createAppSocket: () => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn() }),
}));

function renderApp(path: string) {
  return render(
    <AuthProvider>
      <LiveProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </LiveProvider>
    </AuthProvider>,
  );
}

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
}

/** The stub returns the day that was asked for, so week columns stay distinct. */
function requestedDate(url: string): string {
  return url.match(/[?&]date=(\d{4}-\d{2}-\d{2})/)?.[1] ?? '2026-03-10';
}

const USER = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  college: null,
  timezone: 'Asia/Kolkata',
};

const EFFECTIVE_DAY = {
  occurrenceDate: '2026-03-10',
  version: 1,
  entries: [
    {
      entryId: 'e1',
      courseId: 'c1',
      courseCode: 'DBMS',
      courseName: 'Database Systems',
      day: 2,
      startTime: '11:00',
      endTime: '11:50',
      room: 'A-101',
      kind: 'LECTURE',
      status: 'SCHEDULED',
      changeId: null,
      changed: false,
      previousStartTime: null,
    },
  ],
};

describe('ClassSync app shell', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows the login screen when there is no session', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderApp('/dashboard');

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders the dashboard with live data for an authenticated user', async () => {
    localStorage.setItem('classsync.token', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse(USER);
        }
        if (url.includes('/api/changes/effective')) {
          return jsonResponse({ ...EFFECTIVE_DAY, occurrenceDate: requestedDate(url) });
        }
        return jsonResponse([]);
      }),
    );

    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect((await screen.findAllByText(/DBMS/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/classes today/i)).toBeInTheDocument();
  });

  it('renders the timetable view with the effective schedule', async () => {
    localStorage.setItem('classsync.token', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return jsonResponse(USER);
        }
        if (url.includes('/api/changes/effective')) {
          return jsonResponse({ ...EFFECTIVE_DAY, occurrenceDate: requestedDate(url) });
        }
        return jsonResponse([]);
      }),
    );

    renderApp('/timetable');

    expect(await screen.findByRole('heading', { name: /timetable/i })).toBeInTheDocument();
    expect((await screen.findAllByText(/Database Systems/)).length).toBeGreaterThan(0);
  });
});
