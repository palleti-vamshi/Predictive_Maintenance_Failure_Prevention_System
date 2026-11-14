import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { getPythonExecutable } from './mlJob.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '../scripts/safe_archive_extractor.py');

/**
 * Checks if a file has an archive extension.
 */
export function isArchiveFile(filename) {
  if (!filename || typeof filename !== 'string') return false;
  const lower = filename.toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.gz')
  );
}

/**
 * Validates and safely extracts an archive without memory buffering or decompression bomb vulnerabilities.
 * Enforces path traversal checks, max uncompressed size, compression ratio, file count, and nested archive bans.
 */
export async function validateAndExtractArchive({
  archivePath,
  outputDir,
  maxUncompressedBytes = env.MAX_RESEARCH_UPLOAD_SIZE_BYTES,
  maxCompressionRatio = 100,
  maxFiles = 500
}) {
  if (!fs.existsSync(archivePath)) {
    const err = new Error(`Archive file not found at: ${archivePath}`);
    err.status = 404;
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  const pythonBin = getPythonExecutable();
  fs.mkdirSync(outputDir, { recursive: true });

  const args = [
    SCRIPT_PATH,
    '--archive-path',
    archivePath,
    '--output-dir',
    outputDir,
    '--max-uncompressed-bytes',
    String(maxUncompressedBytes),
    '--max-compression-ratio',
    String(maxCompressionRatio),
    '--max-files',
    String(maxFiles)
  ];

  return new Promise((resolve, reject) => {
    let stdoutData = '';
    let stderrData = '';

    const proc = spawn(pythonBin, args, {
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        PYTHONUNBUFFERED: '1'
      }
    });

    const timeoutTimer = setTimeout(() => {
      proc.kill('SIGKILL');
      const err = new Error('Archive extraction timed out after 60 seconds.');
      err.status = 408;
      err.code = 'EXTRACTION_TIMEOUT';
      reject(err);
    }, 60000);

    proc.stdout.on('data', (d) => {
      stdoutData += d.toString();
    });

    proc.stderr.on('data', (d) => {
      stderrData += d.toString();
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timeoutTimer);

      try {
        const trimmed = stdoutData.trim();
        const jsonMatch = trimmed.match(/\{[\s\S]*\}$/);
        if (!jsonMatch) {
          const err = new Error(
            `Archive extractor returned invalid output (exit code ${exitCode}): ${stderrData || stdoutData}`
          );
          err.status = 400;
          err.code = 'EXTRACTION_FAILED';
          return reject(err);
        }

        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.success) {
          const err = new Error(parsed.error || 'Archive validation failed.');
          err.status = 400;
          err.code = parsed.code || 'ARCHIVE_SECURITY_VIOLATION';
          return reject(err);
        }

        resolve(parsed);
      } catch (parseErr) {
        const err = new Error(
          `Failed to parse archive extraction output: ${parseErr.message} (Raw: ${stdoutData})`
        );
        err.status = 500;
        err.code = 'PARSER_ERROR';
        reject(err);
      }
    });

    proc.on('error', (spawnErr) => {
      clearTimeout(timeoutTimer);
      const err = new Error(`Failed to spawn archive extractor: ${spawnErr.message}`);
      err.status = 500;
      err.code = 'SPAWN_ERROR';
      reject(err);
    });
  });
}

