import mongoose from 'mongoose';
import { env } from './env.js';
import { DATABASE_STATUS } from '@predictive-maintenance/shared';

let connectionStatus = DATABASE_STATUS.DISCONNECTED;
let connectionError = null;

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
    console.warn('[Database] To enable database persistence, ensure MongoDB is running (e.g. `brew services start mongodb-community` or `docker run -d -p 27017:27017 mongo`).');
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

