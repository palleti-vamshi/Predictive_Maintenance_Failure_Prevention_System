import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setItem, getItem, removeItem } from '../services/storage.js';
import { API_BASE } from '../services/apiConfig.js';

const STORAGE_KEY = 'pm_session_token';

const AuthContext = createContext({
  user: null,
  token: null,
  isLoading: true,
  authError: null,
  login: async () => false,
  logout: async () => {},
  clearError: () => {},
  refreshUser: async () => {}
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Restore session from SecureStore on startup
  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const storedToken = await getItem(STORAGE_KEY);
      if (!storedToken) {
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/auth/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${storedToken}`,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setToken(storedToken);
      } else {
        // Token invalid, expired, or revoked
        await removeItem(STORAGE_KEY);
        setUser(null);
        setToken(null);
      }
    } catch (err) {
      console.warn('[AuthContext] Session restore check failed:', err.message);
      // Keep state clear on network error during restore
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const login = async (email, password) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ emailOrUsername: email, email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.message || 'Login failed. Please check your credentials.');
        setIsLoading(false);
        return false;
      }

      if (data.sessionToken) {
        await setItem(STORAGE_KEY, data.sessionToken);
        setToken(data.sessionToken);
      }
      setUser(data.user);
      setIsLoading(false);
      return true;
    } catch (err) {
      const msg = err.message.includes('Network') || err.message.includes('fetch')
        ? 'Cannot reach backend API server at ' + API_BASE + '. Please verify the server is running.'
        : 'Network or system error: ' + err.message;
      setAuthError(msg);
      setIsLoading(false);
      return false;
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      if (token) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
      }
    } catch (err) {
      console.warn('[AuthContext] Remote logout notification failed:', err.message);
    } finally {
      await removeItem(STORAGE_KEY);
      setUser(null);
      setToken(null);
      setAuthError(null);
      setIsLoading(false);
    }
  };

  const clearError = () => {
    setAuthError(null);
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch {
      // ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        authError,
        login,
        logout,
        clearError,
        refreshUser
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
