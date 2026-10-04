import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App routing', () => {
  beforeEach(() => {
    // The dashboard health check must not hit the network during tests.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, service: 'classsync-server', uptimeSeconds: 12 }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects / to the dashboard', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('shows the server status once the health check resolves', async () => {
    renderAt('/dashboard');
    expect(await screen.findByText(/server online/i)).toBeInTheDocument();
  });

  it('renders a not-found page for unknown routes', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
