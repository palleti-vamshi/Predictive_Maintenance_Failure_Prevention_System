import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Check current session on mount via GET /api/auth/me (using HttpOnly cookie)
  const checkCurrentSession = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const url = `${API_BASE}/auth/me`;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkCurrentSession();
  }, [checkCurrentSession]);

  // Login action
  const login = async (emailOrUsername, password) => {
    setLoading(true);
    setAuthError(null);
    try {
      const url = `${API_BASE}/auth/login`;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ emailOrUsername, password })
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.message || 'Login failed. Please check your credentials.';
        setAuthError(msg);
        return { success: false, message: msg };
      }

      setUser(data.user);
      setAuthError(null);
      return { success: true, user: data.user };
    } catch (err) {
      const msg = err.message || 'Network error connecting to API server.';
      setAuthError(msg);
      return { success: false, message: msg };
    } finally {
      setLoading(false);
    }
  };

  // Logout action
  const logout = async () => {
    setLoading(true);
    try {
      const url = `${API_BASE}/auth/logout`;
      await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
    } catch (err) {
      console.warn('[AuthContext] Logout network error:', err);
    } finally {
      setUser(null);
      setAuthError(null);
      setLoading(false);
    }
  };

  // Development Quick-Fill / Demo Logins
  const quickDemoLogin = async (roleType) => {
    const creds = {
      manager: { user: 'manager@detroit.factory', pass: 'Manager123!' },
      technician: { user: 'tech@detroit.factory', pass: 'Tech123!' },
      viewer: { user: 'viewer@detroit.factory', pass: 'Viewer123!' }
    };

    const target = creds[roleType] || creds.technician;
    return login(target.user, target.pass);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        isAuthenticated: !!user,
        login,
        logout,
        quickDemoLogin,
        refreshSession: checkCurrentSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

