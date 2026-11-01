import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import TechnicianNavigator from './src/navigation/TechnicianNavigator.js';
import LoginScreen from './src/screens/LoginScreen.js';
import { AuthProvider, useAuth } from './src/context/AuthContext.js';
import { API_BASE } from './src/services/apiConfig.js';

function MobileRoot() {
  const { user, isLoading } = useAuth();
  const [apiStatus, setApiStatus] = useState(null);

  const checkApiHealth = useCallback(async () => {
    try {
      const url = API_BASE.endsWith('/health') ? API_BASE : `${API_BASE}/health`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setApiStatus(data);
      } else {
        setApiStatus(null);
      }
    } catch {
      setApiStatus(null);
    }
  }, []);

  useEffect(() => {
    checkApiHealth();
  }, [checkApiHealth]);

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingTitle}>Predictive Maintenance</Text>
          <Text style={styles.loadingSubtext}>Verifying Terminal Session...</Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {user ? (
        <TechnicianNavigator
          apiStatus={apiStatus}
          onRefreshApi={checkApiHealth}
        />
      ) : (
        <LoginScreen />
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MobileRoot />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: '#070b14',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingBox: {
    alignItems: 'center',
    gap: 12,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.3,
  },
  loadingSubtext: {
    fontSize: 12,
    color: '#94a3b8',
  },
});
