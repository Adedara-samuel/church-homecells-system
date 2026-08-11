'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, tokenStore } from '@/lib/api-client';
import type { SessionUser } from '@/types';

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  /** Server-side authorisation is authoritative; this only shapes the UI. */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
  hasRole: (...roles: SessionUser['role'][]) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  const loadSession = React.useCallback(async () => {
    if (!tokenStore.access && !tokenStore.refresh) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const result = await api.get<{ user: SessionUser }>('/auth/session');
      setUser(result.data.user);
    } catch (err) {
      // A 401 here means both tokens are dead; anything else leaves the user
      // signed out too, but without hiding the underlying problem in the console.
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error('Failed to restore session', err);
      }
      tokenStore.clear();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = React.useCallback(
    async (identifier: string, password: string) => {
      const result = await api.post<{
        user: SessionUser;
        accessToken: string;
        refreshToken: string;
      }>('/auth/login', { identifier, password }, { anonymous: true });

      tokenStore.set(result.data.accessToken, result.data.refreshToken);
      setUser(result.data.user);
      // Anything cached for a previous user must not leak into this session.
      queryClient.clear();
      return result.data.user;
    },
    [queryClient],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // A failed logout call must never trap the user in the application.
    }
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
    router.push('/login');
  }, [queryClient, router]);

  const value = React.useMemo<AuthContextValue>(() => {
    const permissions = new Set(user?.permissions ?? []);
    return {
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      logout,
      refreshSession: loadSession,
      can: (permission) => permissions.has(permission),
      canAny: (...list) => list.some((permission) => permissions.has(permission)),
      hasRole: (...roles) => (user ? roles.includes(user.role) : false),
    };
  }, [user, isLoading, login, logout, loadSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/** Renders children only when the user holds the permission. */
export function Can({
  permission,
  anyOf,
  fallback = null,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { can, canAny } = useAuth();
  const allowed = permission ? can(permission) : anyOf ? canAny(...anyOf) : true;
  return <>{allowed ? children : fallback}</>;
}
