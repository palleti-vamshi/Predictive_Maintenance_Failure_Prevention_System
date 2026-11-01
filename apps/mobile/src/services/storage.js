import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const memoryStore = new Map();

/**
 * Cross-platform persistent token storage helper.
 * Uses expo-secure-store on native platforms (iOS / Android),
 * falling back to localStorage on web or an in-memory map.
 */
export async function setItem(key, value) {
  try {
    if (Platform.OS !== 'web') {
      const isAvailable = await SecureStore.isAvailableAsync();
      if (isAvailable) {
        await SecureStore.setItemAsync(key, String(value));
        return;
      }
    }
  } catch (err) {
    console.warn('[Storage] SecureStore setItem failed, falling back:', err.message);
  }

  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    try {
      globalThis.localStorage.setItem(key, String(value));
      return;
    } catch {
      // ignore
    }
  }

  memoryStore.set(key, String(value));
}

export async function getItem(key) {
  try {
    if (Platform.OS !== 'web') {
      const isAvailable = await SecureStore.isAvailableAsync();
      if (isAvailable) {
        return await SecureStore.getItemAsync(key);
      }
    }
  } catch (err) {
    console.warn('[Storage] SecureStore getItem failed, falling back:', err.message);
  }

  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      // ignore
    }
  }

  return memoryStore.get(key) || null;
}

export async function removeItem(key) {
  try {
    if (Platform.OS !== 'web') {
      const isAvailable = await SecureStore.isAvailableAsync();
      if (isAvailable) {
        await SecureStore.deleteItemAsync(key);
        return;
      }
    }
  } catch (err) {
    console.warn('[Storage] SecureStore removeItem failed, falling back:', err.message);
  }

  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    try {
      globalThis.localStorage.removeItem(key);
      return;
    } catch {
      // ignore
    }
  }

  memoryStore.delete(key);
}

