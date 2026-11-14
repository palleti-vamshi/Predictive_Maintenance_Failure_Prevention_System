import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from apps/server or current working dir if available
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storageDir = process.env.FILE_STORAGE_DIR || path.resolve(__dirname, '../../uploads');

export const env = {
  HOST: process.env.HOST || '0.0.0.0',
  PORT: parseInt(process.env.PORT, 10) || 5001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/predictive_maintenance',
  FILE_STORAGE_DIR: storageDir,
  UPLOAD_STAGING_DIR: process.env.UPLOAD_STAGING_DIR || path.resolve(storageDir, 'staging'),
  UPLOAD_CHUNK_DIR: process.env.UPLOAD_CHUNK_DIR || path.resolve(storageDir, 'chunks'),
  MAX_RESEARCH_UPLOAD_SIZE_BYTES:
    parseInt(process.env.MAX_RESEARCH_UPLOAD_SIZE_BYTES, 10) || 1024 * 1024 * 1024, // 1 GB
  MAX_OPERATIONAL_UPLOAD_SIZE_BYTES:
    parseInt(process.env.MAX_OPERATIONAL_UPLOAD_SIZE_BYTES, 10) || 50 * 1024 * 1024, // 50 MB
  FACTORY_RESEARCH_STORAGE_QUOTA_BYTES:
    parseInt(process.env.FACTORY_RESEARCH_STORAGE_QUOTA_BYTES, 10) || 5 * 1024 * 1024 * 1024, // 5 GB
  DEFAULT_CHUNK_SIZE_BYTES:
    parseInt(process.env.DEFAULT_CHUNK_SIZE_BYTES, 10) || 5 * 1024 * 1024, // 5 MB
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production'
};
