import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { MAX_UPLOAD_SIZE_BYTES } from '@predictive-maintenance/shared';

// Ensure storage and staging directories exist
const storageDir = path.resolve(env.FILE_STORAGE_DIR);
const stagingDir = path.resolve(env.UPLOAD_STAGING_DIR || path.join(storageDir, 'staging'));

if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}
if (!fs.existsSync(stagingDir)) {
  fs.mkdirSync(stagingDir, { recursive: true });
}

/**
 * Returns safe staging directory for an upload session.
 */
export function getChunkDir(uploadId) {
  if (!uploadId || !/^[a-zA-Z0-9_-]+$/.test(uploadId)) {
    throw new Error('Invalid upload session identifier');
  }
  const targetDir = path.join(stagingDir, uploadId);
  return targetDir;
}

/**
 * Returns safe chunk file path.
 */
export function getChunkPath(uploadId, chunkIndex) {
  const dir = getChunkDir(uploadId);
  return path.join(dir, `chunk_${parseInt(chunkIndex, 10)}`);
}

/**
 * Write a chunk buffer directly to disk.
 */
export async function saveChunkBuffer({ uploadId, chunkIndex, buffer, expectedChunkSize }) {
  const dir = getChunkDir(uploadId);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  if (expectedChunkSize !== undefined && buffer.length !== expectedChunkSize) {
    const err = new Error(`Chunk size mismatch: expected ${expectedChunkSize} bytes, received ${buffer.length} bytes.`);
    err.status = 400;
    err.code = 'CHUNK_SIZE_MISMATCH';
    throw err;
  }

  const chunkPath = getChunkPath(uploadId, chunkIndex);
  await fs.promises.writeFile(chunkPath, buffer);
  return {
    uploadId,
    chunkIndex: parseInt(chunkIndex, 10),
    bytesWritten: buffer.length
  };
}

/**
 * Streams a chunk from a readable stream directly to disk.
 */
export async function saveChunkStream({ uploadId, chunkIndex, readableStream, expectedChunkSize }) {
  const dir = getChunkDir(uploadId);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const chunkPath = getChunkPath(uploadId, chunkIndex);
  const tempPath = `${chunkPath}.tmp`;
  const writeStream = fs.createWriteStream(tempPath);

  let bytesWritten = 0;

  await new Promise((resolve, reject) => {
    readableStream.on('data', (chunk) => {
      bytesWritten += chunk.length;
    });
    readableStream.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    readableStream.on('error', reject);
  });

  if (expectedChunkSize !== undefined && bytesWritten !== expectedChunkSize) {
    await fs.promises.unlink(tempPath).catch(() => {});
    const err = new Error(`Chunk size mismatch: expected ${expectedChunkSize} bytes, received ${bytesWritten} bytes.`);
    err.status = 400;
    err.code = 'CHUNK_SIZE_MISMATCH';
    throw err;
  }

  await fs.promises.rename(tempPath, chunkPath);

  return {
    uploadId,
    chunkIndex: parseInt(chunkIndex, 10),
    bytesWritten
  };
}

/**
 * Streams chunks sequentially into the final destination file,
 * incrementally computing SHA-256 and byte length without loading into RAM.
 */
export async function assembleChunks({
  uploadId,
  totalChunks,
  expectedSha256,
  expectedSizeBytes,
  originalFilename,
  mimeType
}) {
  const dir = getChunkDir(uploadId);
  if (!fs.existsSync(dir)) {
    const err = new Error('Chunk staging directory not found.');
    err.status = 404;
    err.code = 'STAGING_NOT_FOUND';
    throw err;
  }

  // Verify all chunks exist
  for (let i = 0; i < totalChunks; i++) {
    const cp = getChunkPath(uploadId, i);
    if (!fs.existsSync(cp)) {
      const err = new Error(`Missing chunk ${i} of ${totalChunks} during assembly.`);
      err.status = 400;
      err.code = 'INCOMPLETE_CHUNKS';
      err.details = { missingChunk: i, totalChunks };
      throw err;
    }
  }

  const sanitizedOriginal = sanitizeFilename(originalFilename);
  const randomId = crypto.randomUUID();
  const ext = path.extname(sanitizedOriginal).toLowerCase() || '.csv';
  const storageKey = `${randomId}${ext}`;
  const targetPath = path.join(storageDir, storageKey);

  const writeStream = fs.createWriteStream(targetPath);
  const hasher = crypto.createHash('sha256');
  let totalBytesAssembled = 0;

  try {
    for (let i = 0; i < totalChunks; i++) {
      const cp = getChunkPath(uploadId, i);
      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(cp);
        readStream.on('data', (chunk) => {
          hasher.update(chunk);
          totalBytesAssembled += chunk.length;
        });
        readStream.on('error', reject);
        readStream.on('end', resolve);
        readStream.pipe(writeStream, { end: false });
      });
    }

    await new Promise((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });

    const computedSha256 = hasher.digest('hex');

    // Strict Checksum Verification: Never claim upload succeeded if size or checksum mismatch
    if (expectedSizeBytes !== undefined && totalBytesAssembled !== expectedSizeBytes) {
      await fs.promises.unlink(targetPath).catch(() => {});
      const err = new Error(
        `File size mismatch: expected ${expectedSizeBytes} bytes, assembled ${totalBytesAssembled} bytes.`
      );
      err.status = 400;
      err.code = 'SIZE_VERIFICATION_FAILED';
      throw err;
    }

    if (expectedSha256 && computedSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      await fs.promises.unlink(targetPath).catch(() => {});
      const err = new Error(
        `SHA-256 checksum mismatch: expected ${expectedSha256}, computed ${computedSha256}.`
      );
      err.status = 400;
      err.code = 'CHECKSUM_VERIFICATION_FAILED';
      throw err;
    }

    // Clean up staging chunks
    await cleanupUploadStaging(uploadId);

    return {
      storageKey,
      originalFilename: sanitizedOriginal,
      fileSizeBytes: totalBytesAssembled,
      fileChecksumSha256: computedSha256,
      mimeType: mimeType || 'text/csv'
    };
  } catch (err) {
    await fs.promises.unlink(targetPath).catch(() => {});
    throw err;
  }
}

/**
 * Remove temporary upload chunk files and directory.
 */
export async function cleanupUploadStaging(uploadId) {
  try {
    const dir = getChunkDir(uploadId);
    if (fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
    return true;
  } catch (err) {
    console.warn(`[Storage] Failed to cleanup staging for ${uploadId}:`, err.message);
    return false;
  }
}

/**
 * Verify checksum and size of an existing stored file via streaming.
 */
export async function verifyStoredFileChecksum(storageKey, expectedSha256, expectedSizeBytes) {
  const filePath = getSafeFilePath(storageKey);
  const hasher = crypto.createHash('sha256');
  let actualBytes = 0;

  await new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath);
    readStream.on('data', (chunk) => {
      hasher.update(chunk);
      actualBytes += chunk.length;
    });
    readStream.on('error', reject);
    readStream.on('end', resolve);
  });

  const computedSha256 = hasher.digest('hex');

  const sizeOk = expectedSizeBytes === undefined || actualBytes === expectedSizeBytes;
  const hashOk = !expectedSha256 || computedSha256.toLowerCase() === expectedSha256.toLowerCase();

  return {
    valid: sizeOk && hashOk,
    actualBytes,
    computedSha256,
    expectedSizeBytes,
    expectedSha256
  };
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
  if (storageKey.includes('..') || path.isAbsolute(storageKey)) {
    throw new Error('Path traversal attempt detected');
  }
  const normalized = path.normalize(storageKey);
  const resolved = path.resolve(storageDir, normalized);
  const relative = path.relative(storageDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !resolved.startsWith(storageDir + path.sep)) {
    throw new Error('Path traversal attempt detected');
  }
  if (!fs.existsSync(resolved)) {
    const flatResolved = path.resolve(storageDir, path.basename(storageKey));
    if (fs.existsSync(flatResolved)) {
      return flatResolved;
    }
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

