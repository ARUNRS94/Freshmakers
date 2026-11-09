import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';

export type Role = 'ADMIN' | 'BARISTA' | 'MANAGER' | 'SUPERVISOR' | 'OPS_HEAD' | 'CBO' | 'SCM' | 'VENDOR' | 'FINANCE';
export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  region_id: number | null;
  vendor_id: number | null;
  siteIds: number[] | null;
}

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.set(null);
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
    const r = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
    tokenStore.set(r.token);
    setUser(r.user);
  };

  const can = useCallback((...roles: Role[]) => !!user && (user.role === 'ADMIN' || roles.includes(user.role)), [user]);

  return <Ctx.Provider value={{ user, ready, login, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
