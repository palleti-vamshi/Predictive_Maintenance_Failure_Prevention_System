import mongoose from 'mongoose';
import { env } from './env.js';
import { DATABASE_STATUS } from '@predictive-maintenance/shared';

// Disable Mongoose query buffering so database-dependent requests fail-fast when offline instead of hanging
mongoose.set('bufferCommands', false);

let connectionStatus = DATABASE_STATUS.DISCONNECTED;
let connectionError = null;
let reconnectTimer = null;

// Track connection lifecycle events
mongoose.connection.on('connected', () => {
  connectionStatus = DATABASE_STATUS.CONNECTED;
  connectionError = null;
  console.log(`[Database] MongoDB connected successfully to database: ${mongoose.connection.name}`);
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
});

mongoose.connection.on('disconnected', () => {
  connectionStatus = DATABASE_STATUS.DISCONNECTED;
  console.warn('[Database] MongoDB connection dropped. Entering disconnected state.');
  scheduleReconnect();
});

mongoose.connection.on('error', (err) => {
  connectionStatus = DATABASE_STATUS.DISCONNECTED;
  connectionError = err.message;
  console.warn(`[Database] MongoDB connection error: ${err.message}`);
  scheduleReconnect();
});

function scheduleReconnect() {
  if (reconnectTimer || !env.MONGODB_URI || process.env.NODE_ENV === 'test') return;
  console.log('[Database] Background reconnect scheduled (retrying every 5s)...');
  reconnectTimer = setInterval(async () => {
    if (mongoose.connection.readyState === 1) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      return;
    }
    try {
      await mongoose.connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 2000
      });
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    } catch (err) {
      connectionError = err.message;
    }
  }, 5000);
}

/**
 * Checks whether the MongoDB connection is currently established.
 */
export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Fail-fast middleware for endpoints requiring an active database connection.
 * Prevents requests from hanging or failing with cryptic buffer timeout errors.
 */
export function requireDatabaseConnection(req, res, next) {
  if (!isDatabaseConnected()) {
    return res.status(503).json({
      error: 'ServiceUnavailable',
      code: 'DATABASE_UNAVAILABLE',
      message: 'MongoDB is offline or unreachable. Please verify the database service is running (`brew services start mongodb-community@8.0` or `docker compose up -d`).'
    });
  }
  next();
}

/**
 * Attempt to connect to MongoDB.
 * Non-blocking: failures do not terminate the process, enabling server liveness even without an active DB.
 */
export async function connectDB() {
  if (!env.MONGODB_URI) {
    connectionStatus = DATABASE_STATUS.DISCONNECTED;
    console.warn('[Database] MONGODB_URI not provided. Running in disconnected database mode.');
    return;
  }

  try {
    connectionStatus = DATABASE_STATUS.CONNECTING;
    console.log('[Database] Connecting to MongoDB...');

    // 2.5-second timeout so scaffold boots immediately even if MongoDB daemon is not running locally
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 2500
    });

    connectionStatus = DATABASE_STATUS.CONNECTED;
    connectionError = null;
    console.log(`[Database] MongoDB connected successfully to database: ${mongoose.connection.name}`);
  } catch (err) {
    connectionStatus = DATABASE_STATUS.DISCONNECTED;
    connectionError = err.message;
    console.warn('[Database] MongoDB connection failed or timed out.');
    console.warn(`[Database] Reason: ${err.message}`);
    console.warn('[Database] Note: The API server is running normally in offline database mode.');
    console.warn('[Database] To enable database persistence, ensure MongoDB is running (e.g. `brew services start mongodb-community@8.0` or `docker compose up -d`).');
    scheduleReconnect();
  }
}

/**
 * Returns safe database health details without exposing credentials.
 */
export function getDatabaseHealth() {
  const readyStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  const state = readyStates[mongoose.connection.readyState] || 'unknown';

  return {
    status: state === 'connected' ? DATABASE_STATUS.CONNECTED : DATABASE_STATUS.DISCONNECTED,
    readyState: mongoose.connection.readyState,
    readyStateLabel: state,
    hasActiveConnection: mongoose.connection.readyState === 1,
    databaseName: mongoose.connection.readyState === 1 ? mongoose.connection.name : null,
    host: mongoose.connection.readyState === 1 ? mongoose.connection.host : null,
    lastError: connectionError ? 'Unable to reach MongoDB daemon' : null
  };
}

