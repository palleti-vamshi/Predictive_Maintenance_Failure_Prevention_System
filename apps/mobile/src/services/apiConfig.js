import { Platform } from 'react-native';

/**
 * Base API endpoint configuration for mobile clients.
 * Automatically resolves endpoint based on environment and platform:
 * 1. Explicit EXPO_PUBLIC_API_BASE_URL (if provided)
 * 2. Host override from EXPO_PUBLIC_API_HOST and EXPO_PUBLIC_API_PORT
 * 3. Android Emulator special loopback (10.0.2.2:5001) if localhost was provided
 * 4. Safe fallback to local network development default
 */
function resolveApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL && process.env.EXPO_PUBLIC_API_BASE_URL.trim();
  const host = process.env.EXPO_PUBLIC_API_HOST && process.env.EXPO_PUBLIC_API_HOST.trim();
  const port = (process.env.EXPO_PUBLIC_API_PORT && process.env.EXPO_PUBLIC_API_PORT.trim()) || '5001';

  if (envUrl) {
    // If running in Android Emulator and URL specifies localhost, map to 10.0.2.2
    if (Platform.OS === 'android' && envUrl.includes('localhost')) {
      return envUrl.replace('localhost', '10.0.2.2');
    }
    return envUrl;
  }

  if (host) {
    return `http://${host}:${port}/api`;
  }

  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${port}/api`;
  }

  if (Platform.OS === 'ios') {
    return `http://localhost:${port}/api`;
  }

  // Safe development fallback (web / simulator / local host)
  return `http://localhost:${port}/api`;
}

export const API_BASE = resolveApiBaseUrl();

