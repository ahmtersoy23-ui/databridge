import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';

function Probe() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{isLoading ? 'yes' : 'no'}</div>
      <div data-testid="authed">{isAuthenticated ? 'yes' : 'no'}</div>
      <div data-testid="email">{user?.email ?? 'none'}</div>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

const originalLocation = window.location;
const originalFetch = global.fetch;

describe('AuthContext', () => {
  beforeEach(() => {
    // Mocked location + history for clean tests.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        hash: '',
        search: '',
        pathname: '/',
        href: 'http://localhost/',
      },
    });
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it('starts in loading state and resolves to unauthenticated on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false }),
    }) as unknown as typeof fetch;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // initial render before effect resolves: loading=yes
    expect(screen.getByTestId('loading')).toHaveTextContent('yes');

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('no');
    });
    expect(screen.getByTestId('authed')).toHaveTextContent('no');
    expect(screen.getByTestId('email')).toHaveTextContent('none');
  });

  it('hydrates the user from /api/v1/auth/me when the session is valid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        user: { id: 'u1', email: 'a@b.com', name: 'A B', role: 'admin' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('authed')).toHaveTextContent('yes');
    });
    expect(screen.getByTestId('email')).toHaveTextContent('a@b.com');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('forwards SSO token from URL hash as Authorization header and strips it from the URL', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        hash: '#token=sso-xyz',
        search: '',
        pathname: '/dashboard',
        href: 'http://localhost/dashboard#token=sso-xyz',
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        user: { id: 'u2', email: 'sso@iwa.com', name: 'SSO', role: 'user' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('authed')).toHaveTextContent('yes');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sso-xyz' },
      }),
    );
  });

  it('logout calls /auth/logout, clears user, and redirects to SSO portal', async () => {
    const fetchMock = vi
      .fn()
      // initial /me succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          user: { id: 'u3', email: 'lo@x.com', name: 'Lo', role: 'admin' },
        }),
      })
      // logout
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('authed')).toHaveTextContent('yes');
    });

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(screen.getByTestId('authed')).toHaveTextContent('no');
    expect(window.location.href).toContain('apps.iwa.web.tr');
  });
});
