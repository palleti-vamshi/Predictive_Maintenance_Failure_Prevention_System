/**
 * Base API endpoint configuration for mobile clients.
 * Supports EXPO_PUBLIC_API_BASE_URL override for real device testing.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:5001/api';

