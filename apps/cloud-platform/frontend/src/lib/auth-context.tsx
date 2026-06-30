'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, AbacAuthResponse } from './types';
import { api } from './api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// El middleware (server-side) solo puede leer cookies, no localStorage.
// Mantenemos el token en ambos: localStorage para el header Authorization
// y una cookie para que el middleware autorice las rutas protegidas.
const TOKEN_COOKIE = 'accessToken';

function setTokenCookie(token: string, maxAge = 28800) {
  document.cookie = `${TOKEN_COOKIE}=${token}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function clearTokenCookie() {
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      // Re-sincroniza la cookie por si expiró o se perdió (la lee el middleware).
      setTokenCookie(storedToken);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const raw = await api.post<AbacAuthResponse>('/auth/admin/login', { email, password }, { skipAuth: true });
    const user: User = {
      id: raw.user.id,
      email: raw.user.email,
      name: `${raw.user.firstName} ${raw.user.lastName}`.trim(),
      roles: raw.user.roles,
    };
    localStorage.setItem('accessToken', raw.accessToken);
    localStorage.setItem('user', JSON.stringify(user));
    setTokenCookie(raw.accessToken, raw.expiresIn);
    setToken(raw.accessToken);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    clearTokenCookie();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token && !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}