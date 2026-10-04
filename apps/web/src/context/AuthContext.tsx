import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, getToken, setToken, type AuthUser } from '../lib/api';

interface Credentials {
  email: string;
  password: string;
}

interface Registration extends Credentials {
  displayName: string;
}

interface AuthResult {
  user: AuthUser;
  token: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login(credentials: Credentials): Promise<void>;
  register(registration: Registration): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore the session from a stored token.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    api
      .get<AuthUser>('/api/auth/me')
      .then((profile) => {
        if (!cancelled) {
          setUser(profile);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null);
          setTokenState(null);
          setUser(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (credentials: Credentials) => {
    setError(null);
    try {
      const result = await api.post<AuthResult>('/api/auth/login', credentials);
      setToken(result.token);
      setTokenState(result.token);
      setUser(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed');
      throw cause;
    }
  }, []);

  const register = useCallback(async (registration: Registration) => {
    setError(null);
    try {
      const result = await api.post<AuthResult>('/api/auth/register', registration);
      setToken(result.token);
      setTokenState(result.token);
      setUser(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration failed');
      throw cause;
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, error, login, register, logout }),
    [user, token, loading, error, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}