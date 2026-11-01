import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { MAX_UPLOAD_SIZE_BYTES } from '@predictive-maintenance/shared';

// Ensure upload directory exists
const storageDir = path.resolve(env.FILE_STORAGE_DIR);
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

/**
 * Sanitize client filename to prevent path traversal, null bytes, or invalid characters.
 */
export function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed_dataset.csv';
  }
  const basename = path.basename(filename);
  // Remove control characters, quotes, and dangerous shell symbols
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.substring(0, 120);
}

/**
 * Save an uploaded buffer or temporary file to local storage with a random storage key.
 */
export async function saveUploadedFile({ buffer, originalFilename, mimeType }) {
  if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
    const err = new Error(
      `File exceeds maximum permitted upload limit of ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB.`
    );
    err.status = 413;
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const sanitizedOriginal = sanitizeFilename(originalFilename);
  const randomId = crypto.randomUUID();
  const ext = path.extname(sanitizedOriginal).toLowerCase() || '.csv';
  const storageKey = `${randomId}${ext}`;
  const targetPath = path.join(storageDir, storageKey);

  // Compute SHA-256 checksum
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  // Write file to storage
  await fs.promises.writeFile(targetPath, buffer);

  return {
    storageKey,
    originalFilename: sanitizedOriginal,
    fileSizeBytes: buffer.length,
    fileChecksumSha256: hash,
    mimeType: mimeType || 'text/csv'
  };
}

/**
 * Resolve absolute path for storage key safely, preventing path traversal outside storageDir.
 */
export function getSafeFilePath(storageKey) {
  if (!storageKey || typeof storageKey !== 'string') {
    throw new Error('Invalid storage key');
  }
  const safeName = path.basename(storageKey);
  const resolved = path.resolve(storageDir, safeName);
  if (!resolved.startsWith(storageDir)) {
    throw new Error('Path traversal attempt detected');
  }
  if (!fs.existsSync(resolved)) {
    const err = new Error('Stored file not found on disk');
    err.status = 404;
    throw err;
  }
  return resolved;
}

/**
 * Read file contents into a buffer from a storage key.
 */
export async function readStoredFile(storageKey) {
  const filePath = getSafeFilePath(storageKey);
  return fs.promises.readFile(filePath);
}

/**
 * Delete a file by storage key.
 */
export async function deleteStoredFile(storageKey) {
  try {
    const filePath = getSafeFilePath(storageKey);
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}
