import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from apps/server or current working dir if available
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const env = {
  PORT: parseInt(process.env.PORT, 10) || 5001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/predictive_maintenance',
  FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR || path.resolve(__dirname, '../../uploads'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production'
};
