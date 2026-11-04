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

  // Login action with optional expectedRole verification
  const login = async (emailOrUsername, password, expectedRole = null) => {
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
        pass: import.meta.env.VITE_DEMO_MANAGER_PASSWORD || 'Manager123!'
      },
      technician: {
        user: 'tech@pune.bharatdynamics.demo',
        pass: import.meta.env.VITE_DEMO_TECH_PASSWORD || 'Tech123!'
      },
      viewer: {
        user: 'viewer@pune.bharatdynamics.demo',
        pass: import.meta.env.VITE_DEMO_VIEWER_PASSWORD || 'Viewer123!'
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

