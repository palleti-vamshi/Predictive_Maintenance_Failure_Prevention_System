import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [dbOffline, setDbOffline] = useState(false);
  const [apiOffline, setApiOffline] = useState(false);
  const [systemNotice, setSystemNotice] = useState(null);

  // Check current session on mount via GET /api/auth/me (using HttpOnly cookie) with fail-fast timeout
  const checkCurrentSession = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `${API_BASE}/auth/me`;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      if (res.status === 503) {
        // Database offline on server
        const data = await res.json().catch(() => ({}));
        setDbOffline(true);
        setApiOffline(false);
        setSystemNotice(
          data.message ||
            'MongoDB is offline or unreachable. Please start MongoDB using `brew services start mongodb-community@8.0` or `docker compose up -d`.'
        );
        setUser(null);
      } else if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setDbOffline(false);
        setApiOffline(false);
        setSystemNotice(null);
      } else {
        setUser(null);
        setDbOffline(false);
        setApiOffline(false);
      }
    } catch (err) {
      setUser(null);
      if (err.name === 'AbortError') {
        setApiOffline(true);
        setSystemNotice('Session check timed out (3.5s). The backend API server may be offline or unresponsive.');
      } else {
        setApiOffline(true);
        setSystemNotice('Cannot connect to MechGuard AI backend API server. Verify port 5001 is running.');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkCurrentSession();
  }, [checkCurrentSession]);

  // Login action with optional expectedRole verification
  const login = async (emailOrUsername, password, expectedRole = null) => {
    setLoading(true);
    setAuthError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const url = `${API_BASE}/auth/login`;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ emailOrUsername, password }),
        signal: controller.signal
      });

      if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        const msg =
          data.message ||
          'MongoDB is offline or unreachable. Please start MongoDB (`brew services start mongodb-community@8.0` or `docker compose up -d`).';
        setDbOffline(true);
        setAuthError(msg);
        setSystemNotice(msg);
        return { success: false, message: msg, code: 'DATABASE_UNAVAILABLE' };
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.message || 'Login failed. Please check your credentials.';
        setAuthError(msg);
        return { success: false, message: msg };
      }

      setDbOffline(false);
      setApiOffline(false);
      setSystemNotice(null);

      // Role boundary check: Ensure server-verified role matches expected sign-in context
      if (expectedRole) {
        const userRole = data.user.role;
        const matchesManager = expectedRole === 'manager' && userRole === 'factory_manager';
        const matchesTech = expectedRole === 'technician' && userRole === 'technician';

        if (!matchesManager && !matchesTech) {
          // Immediately revoke session cookie on server
          try {
            await fetch(`${API_BASE}/auth/logout`, {
              method: 'POST',
              credentials: 'include',
              headers: { Accept: 'application/json' }
            });
          } catch {
            // ignore logout failure on mismatch cleanup
          }

          const actualLabel =
            userRole === 'factory_manager'
              ? 'Factory Manager'
              : userRole === 'technician'
              ? 'Field Technician'
              : 'Factory Viewer';
          const expectedLabel = expectedRole === 'manager' ? 'Manager' : 'Technician';

          const mismatchMsg = `Role mismatch: This account is authenticated as ${actualLabel}, which does not match your selected ${expectedLabel} sign-in context. Please switch the role choice or sign in with an authorized account.`;
          setAuthError(mismatchMsg);
          return { success: false, message: mismatchMsg };
        }
      }

      // Direct user to role-specific landing page
      if (data.user.role === 'technician') {
        window.location.hash = '#/maintenance';
      } else {
        window.location.hash = '#/';
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

  // Switch active factory scope (Factory Managers)
  const switchFactory = async (factoryId) => {
    setLoading(true);
    try {
      const url = `${API_BASE}/auth/switch-factory`;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ factoryId })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to switch factory.');
      }
      setUser(data.user);
      return { success: true, user: data.user };
    } catch (err) {
      console.error('[AuthContext:switchFactory] Error:', err);
      return { success: false, message: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Development Quick-Fill / Demo Logins
  const quickDemoLogin = async (roleType) => {
    const creds = {
      manager: {
        user: 'manager@pune.bharatdynamics.demo',
        pass: import.meta.env.VITE_DEMO_MANAGER_PASSWORD || ''
      },
      technician: {
        user: 'tech@pune.bharatdynamics.demo',
        pass: import.meta.env.VITE_DEMO_TECH_PASSWORD || ''
      },
      viewer: {
        user: 'viewer@pune.bharatdynamics.demo',
        pass: import.meta.env.VITE_DEMO_VIEWER_PASSWORD || ''
      }
    };

    const target = creds[roleType] || creds.technician;
    const expected = roleType === 'viewer' ? null : roleType;
    return login(target.user, target.pass, expected);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        dbOffline,
        apiOffline,
        systemNotice,
        clearNotice: () => setSystemNotice(null),
        isAuthenticated: !!user,
        login,
        logout,
        quickDemoLogin,
        switchFactory,
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

