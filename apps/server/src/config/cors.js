import { env } from './env.js';

/**
 * Standard development origins for web, mobile, and dev server fallbacks.
 * When port 5173 is occupied, Vite falls back to 5174, 5175, etc.
 */
export const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174', // Vite fallback 1
  'http://127.0.0.1:5174',
  'http://localhost:5175', // Vite fallback 2
  'http://127.0.0.1:5175',
  'http://localhost:4173', // Vite preview port
  'http://127.0.0.1:4173',
  'http://localhost:3000', // React / Node alternative local port
  'http://127.0.0.1:3000',
  'http://localhost:8081', // Expo / Metro bundler
  'http://127.0.0.1:8081',
  'http://localhost:19006', // Expo web
  'http://127.0.0.1:19006'
];

/**
 * Resolves the array of explicitly allowed origins.
 * In development: includes local dev ports + any env-specified origins.
 * In production: strictly includes explicit origins from CORS_ORIGIN (never wildcards).
 */
export function getAllowedOrigins() {
  const envOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const isProduction = process.env.NODE_ENV === 'production' || env.isProd;

  if (isProduction) {
    return envOrigins.length > 0 ? envOrigins : ['https://mechguard.ai'];
  }

  return [...new Set([...DEFAULT_DEV_ORIGINS, ...envOrigins])];
}

/**
 * Checks whether an origin is allowed by the server CORS / CSRF policy.
 */
export function isOriginAllowed(origin) {
  if (!origin) return true; // Native clients, mobile fetch, curl, and same-origin requests
  const allowed = getAllowedOrigins();
  return allowed.includes(origin);
}

/**
 * CORS middleware configuration for Express.
 * Returns callback(null, true) for allowed origins, and callback(null, false)
 * for disallowed origins (preventing unhandled 500 Internal Server Errors).
 */
export const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || isOriginAllowed(origin)) {
      return callback(null, true);
    }
    // Reject by omitting access-control headers rather than throwing 500 error
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
};

