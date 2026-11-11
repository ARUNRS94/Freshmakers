import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';
import { clearLookups } from './hooks';

export type Level = 'view' | 'edit';
export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  role_name: string;
  region_id: number | null;
  vendor_id: number | null;
  employee_id: number | null;
  username: string | null;
  must_change_password: boolean;
  access: Record<string, { view: boolean; edit: boolean }>;
  siteIds: number[] | null;
}

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (current: string, next: string) => Promise<void>;
  /** what the role access table grants */
  allowed: (module: string, level?: Level) => boolean;
  /** for workflow tied to a built-in role, such as approval stages; admins always pass */
  isRole: (...roles: string[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.set(null);
    clearLookups();
    setUser(null);
  }, []);

  useEffect(() => {
    const onLogout = () => logout();
    window.addEventListener('fm:logout', onLogout);
    if (tokenStore.get()) {
      api<User>('/auth/me')
        .then(setUser)
        .catch(() => tokenStore.set(null))
        .finally(() => setReady(true));
    } else setReady(true);
    return () => window.removeEventListener('fm:logout', onLogout);
  }, [logout]);

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { body: { login: email, password } });
    tokenStore.set(r.token);
    clearLookups();
    setUser(r.user);
  };

  const changePassword = async (current: string, next: string) => {
    const r = await api<{ token: string; user: User }>('/auth/change-password', { body: { current, next } });
    tokenStore.set(r.token);
    setUser(r.user);
  };

  const allowed = useCallback((module: string, level: Level = 'view') => !!user && (user.role === 'ADMIN' || !!user.access[module]?.[level]), [user]);
  const isRole = useCallback((...roles: string[]) => !!user && (user.role === 'ADMIN' || roles.includes(user.role)), [user]);

  return <Ctx.Provider value={{ user, ready, login, logout, changePassword, allowed, isRole }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
