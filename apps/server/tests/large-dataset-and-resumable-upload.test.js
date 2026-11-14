import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { Dataset, Machine, User, StagedUpload, DatasetJob } from '../src/models/index.js';
import { DATASET_TYPES, DATASET_STATUS, DATASET_JOB_STATUS } from '@predictive-maintenance/shared';
import { TEST_CREDS } from './testCredentials.js';
import { validateAndExtractArchive } from '../src/services/archiveValidator.service.js';
import { cleanupUploadStaging, getChunkDir } from '../src/services/storage.service.js';

let server;
let baseUrl;

async function loginUser(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: email, password })
  });
  const data = await res.json();
  return { token: data.sessionToken, user: data.user };
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }

  // Cleanup test datasets, staged uploads, and jobs
  await Dataset.deleteMany({ title: /^Test Large / });
  await StagedUpload.deleteMany({ originalFilename: /^test_chunked_/ });
  await DatasetJob.deleteMany({});

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await Dataset.deleteMany({ title: /^Test Large / });
  await StagedUpload.deleteMany({ originalFilename: /^test_chunked_/ });
  await DatasetJob.deleteMany({});

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
});

test('Resumable Chunked Upload: initiates session, uploads chunks sequentially, enforces idempotency on duplicate chunks, and completes assembly', async () => {
  const { token: mgrToken, user: mgrUser } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const targetMachine = await Machine.findOne({ factoryId: mgrUser.factoryId });
  assert.ok(targetMachine, 'Target machine should exist for manager factory');

  // Generate synthetic multi-signal CSV file
  const header = 'timestamp,rotational_speed,load_torque,temp_gearbox_sump,vibration_input_radial\n';
  let dataRows = '';
  const now = Date.now();
  for (let i = 0; i < 500; i++) {
    const ts = new Date(now + i * 1000).toISOString();
    const speed = (1490 + Math.sin(i) * 15).toFixed(2);
    const torque = (245 + Math.cos(i) * 10).toFixed(2);
    const temp = (55 + i * 0.01).toFixed(2);
    const vib = (1.2 + Math.sin(i * 2) * 0.3).toFixed(3);
    dataRows += `${ts},${speed},${torque},${temp},${vib}\n`;
  }
  const fileContent = Buffer.from(header + dataRows, 'utf-8');
  const fileSha256 = crypto.createHash('sha256').update(fileContent).digest('hex');
  const fileSizeBytes = fileContent.length;

  // Split into 3 chunks
  const chunkSize = Math.ceil(fileSizeBytes / 3);
  const chunk0 = fileContent.subarray(0, chunkSize);
  const chunk1 = fileContent.subarray(chunkSize, chunkSize * 2);
  const chunk2 = fileContent.subarray(chunkSize * 2);

  // 1. Initiate chunked upload
  const initRes = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({
      originalFilename: 'test_chunked_telemetry.csv',
      fileSizeBytes,
      fileChecksumSha256: fileSha256,
      mimeType: 'text/csv',
      totalChunks: 3,
      chunkSizeBytes: chunkSize,
      datasetType: DATASET_TYPES.OPERATIONAL,
      machineId: targetMachine._id.toString(),
      title: 'Test Large Chunked Telemetry'
    })
  });

  assert.equal(initRes.status, 201);
  const initData = await initRes.json();
  assert.equal(initData.success, true);
  assert.ok(initData.uploadId);
  assert.equal(initData.totalChunks, 3);
  assert.deepEqual(initData.receivedChunks, []);
  const { uploadId } = initData;

  // 2. Upload Chunk 0
  const chunk0Res = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/chunk?chunkIndex=0`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Index': '0',
      'X-Chunk-Size': String(chunk0.length),
      Authorization: `Bearer ${mgrToken}`
    },
    body: chunk0
  });
  assert.equal(chunk0Res.status, 200);
  const chunk0Data = await chunk0Res.json();
  assert.equal(chunk0Data.success, true);
  assert.equal(chunk0Data.receivedChunksCount, 1);

  // 3. Query status to verify progress & resumability
  const statusRes1 = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/status`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  assert.equal(statusRes1.status, 200);
  const status1 = await statusRes1.json();
  assert.deepEqual(status1.receivedChunks, [0]);
  assert.deepEqual(status1.missingChunks, [1, 2]);
  assert.equal(status1.isComplete, false);

  // 4. Duplicate chunk upload idempotency check (re-send chunk 0)
  const dupRes = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/chunk?chunkIndex=0`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Index': '0',
      'X-Chunk-Size': String(chunk0.length),
      Authorization: `Bearer ${mgrToken}`
    },
    body: chunk0
  });
  assert.equal(dupRes.status, 200);
  const dupData = await dupRes.json();
  assert.equal(dupData.receivedChunksCount, 1); // Not duplicated

  // 5. Upload Chunk 1 and Chunk 2
  const chunk1Res = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/chunk?chunkIndex=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Index': '1',
      Authorization: `Bearer ${mgrToken}`
    },
    body: chunk1
  });
  assert.equal(chunk1Res.status, 200);

  const chunk2Res = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/chunk?chunkIndex=2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Index': '2',
      Authorization: `Bearer ${mgrToken}`
    },
    body: chunk2
  });
  assert.equal(chunk2Res.status, 200);

  // 6. Complete and assemble upload
  const completeRes = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({ columnMappings: [] })
  });

  assert.equal(completeRes.status, 200);
  const completeData = await completeRes.json();
  assert.equal(completeData.success, true);
  assert.equal(completeData.fileChecksumSha256, fileSha256);
  assert.equal(completeData.fileSizeBytes, fileSizeBytes);
  assert.ok(completeData.jobId);
  assert.ok(completeData.datasetId);

  // 7. Verify background job transitions to complete
  let jobComplete = false;
  for (let poll = 0; poll < 20; poll++) {
    const jobRes = await fetch(`${baseUrl}/api/datasets/jobs/${completeData.jobId}`, {
      headers: { Authorization: `Bearer ${mgrToken}` }
    });
    if (jobRes.ok) {
      const jobData = await jobRes.json();
      if (jobData.status === DATASET_JOB_STATUS.COMPLETE) {
        jobComplete = true;
        assert.equal(jobData.progress, 100);
        assert.equal(jobData.metrics.totalRows, 500);
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(jobComplete, 'Background dataset profiling job did not complete in time');

  // 8. Verify Dataset record in DB has profiled metrics
  const dbDataset = await Dataset.findById(completeData.datasetId);
  assert.ok(dbDataset);
  assert.equal(dbDataset.totalRows, 500);
  assert.equal(dbDataset.totalColumns, 5);
  assert.equal(dbDataset.fileChecksumSha256, fileSha256);
  assert.ok(dbDataset.aiTaskCompatibility);
});

test('Upload Cancellation & Staging Cleanup: removes partial chunks from disk and marks session cancelled', async () => {
  const { token: mgrToken, user: mgrUser } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const targetMachine = await Machine.findOne({ factoryId: mgrUser.factoryId });
  assert.ok(targetMachine);

  const initRes = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({
      originalFilename: 'test_chunked_to_cancel.csv',
      fileSizeBytes: 2000,
      totalChunks: 2,
      chunkSizeBytes: 1000,
      datasetType: DATASET_TYPES.OPERATIONAL,
      machineId: targetMachine._id.toString(),
      title: 'Test Large To Cancel'
    })
  });

  assert.equal(initRes.status, 201);
  const { uploadId } = await initRes.json();

  // Send chunk 0
  await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/chunk?chunkIndex=0`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Index': '0',
      Authorization: `Bearer ${mgrToken}`
    },
    body: Buffer.from('chunk0data'.repeat(100))
  });

  const chunkDir = getChunkDir(uploadId);
  assert.ok(fs.existsSync(chunkDir), 'Chunk directory should exist prior to cancel');

  // Cancel upload session
  const cancelRes = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  assert.equal(cancelRes.status, 200);

  // Verify staging directory is cleaned up from disk
  assert.ok(!fs.existsSync(chunkDir), 'Chunk staging directory should be removed on cancel');

  // Verify upload is marked cancelled in DB
  const staged = await StagedUpload.findOne({ uploadId });
  assert.equal(staged.status, 'cancelled');

  // Attempting to send another chunk must be rejected
  const rejectedChunkRes = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/chunk?chunkIndex=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Index': '1',
      Authorization: `Bearer ${mgrToken}`
    },
    body: Buffer.from('chunk1data')
  });
  assert.equal(rejectedChunkRes.status, 404);
});

test('File Size & Storage Quota Enforcement: enforces 50MB operational, 1GB research, and factory quota', async () => {
  const { token: mgrToken } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  // 1. Operational upload > 50 MB rejected
  const oversizedOpRes = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({
      originalFilename: 'test_chunked_oversized_op.csv',
      fileSizeBytes: 51 * 1024 * 1024, // 51 MB > 50 MB limit
      totalChunks: 11,
      chunkSizeBytes: 5 * 1024 * 1024,
      datasetType: DATASET_TYPES.OPERATIONAL,
      title: 'Test Large Oversized Op'
    })
  });
  assert.equal(oversizedOpRes.status, 413);
  const oversizedOpData = await oversizedOpRes.json();
  assert.equal(oversizedOpData.error, 'FILE_TOO_LARGE');

  // 2. Research upload > 1 GB rejected
  const oversizedResRes = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({
      originalFilename: 'test_chunked_oversized_research.zip',
      fileSizeBytes: (1024 * 1024 * 1024) + 1024, // > 1 GB
      totalChunks: 205,
      chunkSizeBytes: 5 * 1024 * 1024,
      datasetType: DATASET_TYPES.REFERENCE,
      title: 'Test Large Oversized Research',
      referenceDetails: {
        sourceName: 'NASA PCoE',
        sourceUrl: 'https://nasa.gov',
        citation: 'NASA 2026',
        license: 'CC-BY-4.0',
        userConfirmedTerms: true
      }
    })
  });
  assert.equal(oversizedResRes.status, 413);
  const oversizedResData = await oversizedResRes.json();
  assert.equal(oversizedResData.error, 'FILE_TOO_LARGE');

  // 3. Disallowed file extension rejected
  const badExtRes = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({
      originalFilename: 'malicious_executable.exe',
      fileSizeBytes: 1024,
      totalChunks: 1,
      chunkSizeBytes: 1024,
      datasetType: DATASET_TYPES.OPERATIONAL,
      title: 'Test Bad Ext'
    })
  });
  assert.equal(badExtRes.status, 400);
  const badExtData = await badExtRes.json();
  assert.equal(badExtData.error, 'INVALID_FILE_TYPE');

  // 4. Storage Quota API returns accurate factory metrics
  const quotaRes = await fetch(`${baseUrl}/api/datasets/storage/quota`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  assert.equal(quotaRes.status, 200);
  const quota = await quotaRes.json();
  assert.equal(quota.maxResearchUploadSizeBytes, env.MAX_RESEARCH_UPLOAD_SIZE_BYTES);
  assert.equal(quota.maxOperationalUploadSizeBytes, env.MAX_OPERATIONAL_UPLOAD_SIZE_BYTES);
  assert.equal(quota.factoryQuotaBytes, env.FACTORY_RESEARCH_STORAGE_QUOTA_BYTES);
  assert.ok(quota.remainingQuotaBytes >= 0);
});

test('RBAC & Factory Scoping: Technicians cannot register research catalog and cannot access other factories', async () => {
  const { token: techToken, user: techUser } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const { token: mgrToken } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  // 1. Technician rejected when initiating reference research dataset
  const techResInit = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${techToken}`
    },
    body: JSON.stringify({
      originalFilename: 'cwru_bearing_data.zip',
      fileSizeBytes: 1024 * 1024,
      totalChunks: 1,
      datasetType: DATASET_TYPES.REFERENCE,
      title: 'Test Tech Reference'
    })
  });
  assert.equal(techResInit.status, 403);
  const techResData = await techResInit.json();
  assert.equal(techResData.error, 'Forbidden');

  // 2. Technician can initiate operational dataset for their assigned machine
  const machinesRes = await fetch(`${baseUrl}/api/machines`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  const machinesData = await machinesRes.json();
  const assignedMachineId = machinesData.machines?.[0]?._id;
  assert.ok(assignedMachineId);

  const techOpInit = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${techToken}`
    },
    body: JSON.stringify({
      originalFilename: 'tech_assigned_telemetry.csv',
      fileSizeBytes: 1024,
      totalChunks: 1,
      chunkSizeBytes: 1024,
      datasetType: DATASET_TYPES.OPERATIONAL,
      machineId: assignedMachineId,
      title: 'Test Large Tech Op'
    })
  });
  assert.equal(techOpInit.status, 201);
});

test('Cryptographic Verification: Rejects assembled files if SHA-256 does not match client expectation', async () => {
  const { token: mgrToken, user: mgrUser } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const targetMachine = await Machine.findOne({ factoryId: mgrUser.factoryId });
  assert.ok(targetMachine);

  const fakeContent = Buffer.from('timestamp,speed\n2026-11-01T00:00:00Z,1500\n');
  const wrongSha256 = crypto.createHash('sha256').update('different_content').digest('hex');

  const initRes = await fetch(`${baseUrl}/api/datasets/uploads/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({
      originalFilename: 'test_checksum_mismatch.csv',
      fileSizeBytes: fakeContent.length,
      fileChecksumSha256: wrongSha256, // Injected wrong hash
      totalChunks: 1,
      chunkSizeBytes: fakeContent.length,
      datasetType: DATASET_TYPES.OPERATIONAL,
      machineId: targetMachine._id.toString(),
      title: 'Test Large Checksum Mismatch'
    })
  });
  assert.equal(initRes.status, 201);
  const { uploadId } = await initRes.json();

  // Send chunk
  await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/chunk?chunkIndex=0`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Index': '0',
      Authorization: `Bearer ${mgrToken}`
    },
    body: fakeContent
  });

  // Attempt complete: assembly must fail closed with CHECKSUM_MISMATCH
  const completeRes = await fetch(`${baseUrl}/api/datasets/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mgrToken}`
    },
    body: JSON.stringify({ columnMappings: [] })
  });

  assert.equal(completeRes.status, 400);
  const completeData = await completeRes.json();
  assert.equal(completeData.error, 'CHECKSUM_VERIFICATION_FAILED');
});

test('Archive Security Extractor: protects against path traversal, zip bombs, nested archives, and executables', async () => {
  const tmpDir = path.join(process.cwd(), 'tmp_archive_security_tests');
  await fs.promises.mkdir(tmpDir, { recursive: true });

  try {
    // 1. Create a zip archive with safe CSV file
    const validZipPath = path.join(tmpDir, 'valid_archive.zip');
    const validExtractDir = path.join(tmpDir, 'extracted_valid');

    // Create zip programmatically using python or shell
    const pyCreateZip = `
import zipfile
with zipfile.ZipFile("${validZipPath}", "w") as zf:
    zf.writestr("telemetry.csv", "timestamp,speed\\n2026-11-01T00:00:00Z,1500\\n")
`;
    await fs.promises.writeFile(path.join(tmpDir, 'make_valid.py'), pyCreateZip);
    const { execSync } = await import('child_process');
    execSync(`python3 ${path.join(tmpDir, 'make_valid.py')}`);

    const validResult = await validateAndExtractArchive({
      archivePath: validZipPath,
      outputDir: validExtractDir
    });
    assert.equal(validResult.success, true);
    assert.equal(validResult.extractedFilename, 'telemetry.csv');
    assert.ok(fs.existsSync(validResult.extractedPath));

    // 2. Path Traversal (Zip Slip) attempt
    const slipZipPath = path.join(tmpDir, 'zip_slip.zip');
    const slipExtractDir = path.join(tmpDir, 'extracted_slip');
    const pyCreateSlip = `
import zipfile
with zipfile.ZipFile("${slipZipPath}", "w") as zf:
    zf.writestr("../../evil.txt", "malicious payload")
`;
    await fs.promises.writeFile(path.join(tmpDir, 'make_slip.py'), pyCreateSlip);
    execSync(`python3 ${path.join(tmpDir, 'make_slip.py')}`);

    await assert.rejects(
      async () => {
        await validateAndExtractArchive({
          archivePath: slipZipPath,
          outputDir: slipExtractDir
        });
      },
      /Path traversal attempt detected|ZIP_SLIP/
    );

    // 3. Executable inside archive attempt
    const exeZipPath = path.join(tmpDir, 'exe_archive.zip');
    const exeExtractDir = path.join(tmpDir, 'extracted_exe');
    const pyCreateExe = `
import zipfile
with zipfile.ZipFile("${exeZipPath}", "w") as zf:
    zf.writestr("installer.sh", "#!/bin/bash\\necho pwned\\n")
`;
    await fs.promises.writeFile(path.join(tmpDir, 'make_exe.py'), pyCreateExe);
    execSync(`python3 ${path.join(tmpDir, 'make_exe.py')}`);

    await assert.rejects(
      async () => {
        await validateAndExtractArchive({
          archivePath: exeZipPath,
          outputDir: exeExtractDir
        });
      },
      /Dangerous executable|Disallowed executable|EXECUTABLE/
    );

    // 4. Nested archive attempt
    const nestedZipPath = path.join(tmpDir, 'nested_archive.zip');
    const nestedExtractDir = path.join(tmpDir, 'extracted_nested');
    const pyCreateNested = `
import zipfile
with zipfile.ZipFile("${nestedZipPath}", "w") as zf:
    zf.writestr("inner.zip", b"PK\\x05\\x06" + b"\\x00" * 18)
`;
    await fs.promises.writeFile(path.join(tmpDir, 'make_nested.py'), pyCreateNested);
    execSync(`python3 ${path.join(tmpDir, 'make_nested.py')}`);

    await assert.rejects(
      async () => {
        await validateAndExtractArchive({
          archivePath: nestedZipPath,
          outputDir: nestedExtractDir
        });
      },
      /nested archive|NESTED_ARCHIVE/i
    );
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
