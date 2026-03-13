import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const SSO_PORTAL_URL = import.meta.env.VITE_SSO_PORTAL_URL || 'https://apps.iwa.web.tr';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initialize = async () => {
      // Check for SSO token in URL hash (SSO portal redirect)
      let ssoToken: string | null = null;
      const hash = window.location.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash.substring(1));
        ssoToken = hashParams.get('token');
      }

      if (ssoToken) {
        // Remove token from URL
        window.history.replaceState({}, '', window.location.pathname);
        await checkSession(ssoToken);
      } else {
        await checkSession();
      }
    };
    initialize();
  }, []);

  const checkSession = async (ssoToken?: string) => {
    try {
      const headers: Record<string, string> = {};
      if (ssoToken) {
        headers['Authorization'] = `Bearer ${ssoToken}`;
      }

      const res = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          setUser(data.user);
        }
      }
    } catch (err) {
      console.error('Session check failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setUser(null);
    window.location.href = SSO_PORTAL_URL;
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
