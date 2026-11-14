import fs from 'fs';
import readline from 'readline';
import {
  GEARBOX_SIGNAL_BOUNDS,
  GEARBOX_SIGNALS,
  DATASET_MODALITY,
  AI_TASK_TYPES,
  DATASET_STATUS
} from '@predictive-maintenance/shared';
import { detectDelimiter, parseCsvLine } from './csv.service.js';

/**
 * Streams through a tabular CSV file of arbitrary size (up to 1 GB+) in constant memory,
 * computing summary statistics, previews, time series metrics, quality checks, and AI task compatibility.
 */
export async function streamProfileCsv(filePath, options = {}) {
  const {
    maxPreviewRows = 100,
    fileSizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
    columnMappings: userMappings = null,
    onProgress = null,
    checkCancelled = null
  } = options;

  if (!fs.existsSync(filePath)) {
    const err = new Error(`CSV file not found: ${filePath}`);
    err.status = 404;
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  // 1. Read first 64KB sample to detect delimiter and validate headers
  const sampleFd = await fs.promises.open(filePath, 'r');
  const sampleBuf = Buffer.alloc(Math.min(65536, fileSizeBytes || 65536));
  await sampleFd.read(sampleBuf, 0, sampleBuf.length, 0);
  await sampleFd.close();

  const sampleText = sampleBuf.toString('utf-8');
  if (!sampleText.trim()) {
    const err = new Error('The dataset file is empty.');
    err.status = 400;
    err.code = 'EMPTY_FILE';
    throw err;
  }

  const delimiter = detectDelimiter(sampleText);

  // 2. Stream initialization
  const fileStream = fs.createReadStream(filePath, { highWaterMark: 128 * 1024 });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let rawHeaders = null;
  let headers = [];
  let lineIndex = 0;
  let totalRows = 0;
  let processedBytes = 0;
  let malformedRowsCount = 0;
  const firstMalformedExamples = [];

  const previewRows = [];

  // Running column statistics trackers: header -> stats
  const colStats = new Map();

  // Timestamp and Label trackers
  let timeColIndex = -1;
  let labelColIndex = -1;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let previousTimestamp = null;
  let invalidTimestamps = 0;
  let outOfOrderCount = 0;
  let timestampDiffsSum = 0;
  let timestampDiffsCount = 0;

  const labelCounts = new Map();

  // Progress notification cadence: update every 50,000 lines or 5MB
  let lastReportedTime = Date.now();
  let lastReportedLines = 0;

  try {
    for await (const line of rl) {
      lineIndex++;
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Header row
      if (rawHeaders === null) {
        rawHeaders = parseCsvLine(trimmed, delimiter);
        headers = rawHeaders.map((h) => h.trim());

        // Validate headers
        const headerSet = new Set();
        const duplicateHeaders = [];
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i];
          if (!h) {
            const err = new Error(`Header at column position ${i + 1} is empty.`);
            err.status = 400;
            err.code = 'EMPTY_HEADER';
            throw err;
          }
          const lower = h.toLowerCase();
          if (headerSet.has(lower)) {
            duplicateHeaders.push(h);
          }
          headerSet.add(lower);

          // Detect time/label column roles
          if (timeColIndex === -1 && /(time|date|timestamp|ts|epoch|datetime|simtime)/i.test(lower)) {
            timeColIndex = i;
          }
          if (labelColIndex === -1 && /(label|fault|class|health|defect|status|mode|state)/i.test(lower)) {
            labelColIndex = i;
          }

          // Initialize running stats
          colStats.set(h, {
            count: 0,
            nullCount: 0,
            numericCount: 0,
            sum: 0,
            sumSq: 0,
            min: Infinity,
            max: -Infinity,
            outOfBoundsCount: 0
          });
        }

        if (duplicateHeaders.length > 0) {
          const err = new Error(`CSV file contains duplicate headers: ${duplicateHeaders.join(', ')}`);
          err.status = 400;
          err.code = 'DUPLICATE_HEADERS';
          throw err;
        }

        continue;
      }

      // Check cancellation request
      if (checkCancelled && checkCancelled()) {
        const err = new Error('Dataset processing was cancelled by user.');
        err.status = 499;
        err.code = 'PROCESSING_CANCELLED';
        throw err;
      }

      // Data row
      const fields = parseCsvLine(trimmed, delimiter);
      if (fields.length !== headers.length) {
        malformedRowsCount++;
        if (firstMalformedExamples.length < 5) {
          firstMalformedExamples.push({
            line: lineIndex,
            expectedCols: headers.length,
            actualCols: fields.length
          });
        }
        continue;
      }

      totalRows++;

      // Collect limited preview rows
      if (previewRows.length < maxPreviewRows) {
        const rowObj = {};
        for (let c = 0; c < headers.length; c++) {
          rowObj[headers[c]] = fields[c];
        }
        previewRows.push(rowObj);
      }

      // Column statistics
      for (let c = 0; c < headers.length; c++) {
        const colName = headers[c];
        const valStr = fields[c];
        const stats = colStats.get(colName);
        stats.count++;

        if (valStr === '' || valStr === undefined || valStr === null) {
          stats.nullCount++;
          continue;
        }

        const num = parseFloat(valStr);
        if (!isNaN(num) && isFinite(num)) {
          stats.numericCount++;
          stats.sum += num;
          stats.sumSq += num * num;
          if (num < stats.min) stats.min = num;
          if (num > stats.max) stats.max = num;

          // Check standard engineering bounds
          const standardBounds = GEARBOX_SIGNAL_BOUNDS[colName.toLowerCase()];
          if (standardBounds) {
            if (num < standardBounds.min || num > standardBounds.max) {
              stats.outOfBoundsCount++;
            }
          }
        }
      }

      // Timestamp processing
      if (timeColIndex !== -1 && fields[timeColIndex]) {
        const tStr = fields[timeColIndex].trim();
        let parsedMs = null;

        if (/^\d{10,13}$/.test(tStr)) {
          const num = parseInt(tStr, 10);
          parsedMs = num > 1e11 ? num : num * 1000;
        } else if (/^\d+(\.\d+)?$/.test(tStr)) {
          parsedMs = Math.round(parseFloat(tStr) * 1000);
        } else {
          const d = new Date(tStr);
          if (!isNaN(d.getTime())) {
            parsedMs = d.getTime();
          }
        }

        if (parsedMs !== null) {
          if (firstTimestamp === null) firstTimestamp = parsedMs;
          lastTimestamp = parsedMs;

          if (previousTimestamp !== null) {
            if (parsedMs < previousTimestamp) {
              outOfOrderCount++;
            } else {
              const diff = parsedMs - previousTimestamp;
              if (diff > 0 && diff < 3600000) {
                timestampDiffsSum += diff;
                timestampDiffsCount++;
              }
            }
          }
          previousTimestamp = parsedMs;
        } else {
          invalidTimestamps++;
        }
      }

      // Label processing
      if (labelColIndex !== -1 && fields[labelColIndex]) {
        const lStr = fields[labelColIndex].trim();
        if (lStr) {
          labelCounts.set(lStr, (labelCounts.get(lStr) || 0) + 1);
        }
      }

      // Periodic progress emission
      processedBytes += line.length + 1;
      const now = Date.now();
      if (onProgress && (totalRows - lastReportedLines >= 50000 || now - lastReportedTime >= 1000)) {
        const progressPct = fileSizeBytes > 0 ? Math.min(95, Math.round((processedBytes / fileSizeBytes) * 100)) : 50;
        onProgress({
          processedBytes,
          totalBytes: fileSizeBytes,
          totalRows,
          progressPercent: progressPct
        });
        lastReportedLines = totalRows;
        lastReportedTime = now;
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  if (totalRows === 0) {
    const err = new Error('CSV file contains headers but no valid data rows.');
    err.status = 400;
    err.code = 'NO_DATA_ROWS';
    throw err;
  }

  // Candidate signal mappings
  const candidateMappings = headers.map((header) => {
    const lower = header.toLowerCase();
    let isTimestamp = headers.indexOf(header) === timeColIndex;
    let isLabel = headers.indexOf(header) === labelColIndex;
    let mappedSignal = null;
    let suggestedUnit = '';

    for (const [key, sig] of Object.entries(GEARBOX_SIGNALS)) {
      const sigKey = sig.key.toLowerCase();
      if (lower.includes(sigKey) || sigKey.includes(lower)) {
        mappedSignal = sig.key;
        suggestedUnit = sig.standardUnit;
        break;
      }
    }

    return {
      rawHeader: header,
      mappedSignal,
      isTimestamp,
      isLabel,
      suggestedUnit
    };
  });

  // 3. Assemble column summary structures
  const columns = headers.map((header) => {
    const stats = colStats.get(header);
    const isNumeric = stats.numericCount > stats.count * 0.7;
    const mean = stats.numericCount > 0 ? stats.sum / stats.numericCount : null;
    const missingPct = stats.count > 0 ? Number(((stats.nullCount / stats.count) * 100).toFixed(2)) : 0;
    const candidate = candidateMappings.find((c) => c.rawHeader === header);
    const userMap = userMappings?.find((m) => m.rawHeader === header);

    return {
      rawHeader: header,
      mappedSignal: userMap?.mappedSignal !== undefined ? userMap.mappedSignal : (candidate?.mappedSignal || null),
      isTimestamp: userMap?.isTimestamp !== undefined ? Boolean(userMap.isTimestamp) : Boolean(candidate?.isTimestamp),
      isLabel: userMap?.isLabel !== undefined ? Boolean(userMap.isLabel) : Boolean(candidate?.isLabel),
      sourceUnit: userMap?.sourceUnit || candidate?.suggestedUnit || '',
      dataType: isNumeric ? 'numeric' : 'string',
      stats: {
        missingCount: stats.nullCount,
        missingPct,
        min: stats.min === Infinity ? null : stats.min,
        max: stats.max === -Infinity ? null : stats.max,
        mean: mean !== null ? Number(mean.toFixed(4)) : null,
        outOfBoundsCount: stats.outOfBoundsCount
      }
    };
  });

  // Time Range & Sampling Metrics
  let timeRange = null;
  let samplingRateHz = null;
  let samplingIntervalMeanMs = null;

  if (firstTimestamp !== null && lastTimestamp !== null) {
    const durationSeconds = Math.max(0, Math.round((lastTimestamp - firstTimestamp) / 1000));
    timeRange = {
      start: new Date(firstTimestamp),
      end: new Date(lastTimestamp),
      durationSeconds
    };

    if (timestampDiffsCount > 10) {
      samplingIntervalMeanMs = Number((timestampDiffsSum / timestampDiffsCount).toFixed(2));
      if (samplingIntervalMeanMs > 0) {
        samplingRateHz = Number((1000 / samplingIntervalMeanMs).toFixed(2));
      }
    }
  }

  // Quality findings
  const qualityFindings = [];
  if (malformedRowsCount > 0) {
    qualityFindings.push({
      severity: 'error',
      code: 'MALFORMED_ROWS',
      message: `${malformedRowsCount} rows contain mismatched column counts.`,
      affectedCount: malformedRowsCount
    });
  }

  if (invalidTimestamps > 0) {
    qualityFindings.push({
      severity: 'warning',
      code: 'INVALID_TIMESTAMPS',
      message: `${invalidTimestamps} rows contain unparseable timestamps.`,
      affectedCount: invalidTimestamps
    });
  }

  if (outOfOrderCount > 0) {
    qualityFindings.push({
      severity: 'warning',
      code: 'OUT_OF_ORDER_TIMESTAMPS',
      message: `${outOfOrderCount} timestamps appear out of chronological order.`,
      affectedCount: outOfOrderCount
    });
  }

  for (const col of columns) {
    if (col.stats.outOfBoundsCount > 0) {
      qualityFindings.push({
        severity: 'warning',
        code: 'OUT_OF_BOUNDS_VALUES',
        message: `Column "${col.rawHeader}" contains ${col.stats.outOfBoundsCount} values outside plausible engineering limits.`,
        column: col.rawHeader,
        affectedCount: col.stats.outOfBoundsCount
      });
    }
  }

  // Modality Determination
  const labelEntries = Array.from(labelCounts.entries());
  let modality = DATASET_MODALITY.UNLABELED_TELEMETRY;
  if (labelEntries.length >= 2) {
    modality = DATASET_MODALITY.LABELED_FAULTS;
  } else if (timeRange && samplingRateHz && samplingRateHz >= 100) {
    modality = DATASET_MODALITY.RAW_SIGNALS;
  }

  // Label distribution map
  const labelDistribution = {};
  for (const [lbl, cnt] of labelCounts.entries()) {
    labelDistribution[lbl] = cnt;
  }

  // AI Task Compatibility
  const aiTaskCompatibility = {
    [AI_TASK_TYPES.ANOMALY_DETECTION]: {
      isCompatible: totalRows >= 30,
      reason: totalRows >= 30
        ? `Valid telemetry dataset with ${totalRows} rows, compatible with Isolation Forest and PCA.`
        : 'Dataset requires at least 30 samples for calibrated statistical anomaly baselining.',
      recommendedModel: 'Isolation Forest Anomaly Detector'
    },
    [AI_TASK_TYPES.FAULT_CLASSIFICATION]: {
      isCompatible: labelEntries.length >= 2 && totalRows >= 20,
      reason: labelEntries.length >= 2
        ? `Contains labeled ground truth across ${labelEntries.length} condition classes, compatible with Random Forest.`
        : 'Missing multi-class labeled target column required for supervised classification.',
      recommendedModel: 'Random Forest Multi-Class Fault Classifier'
    },
    [AI_TASK_TYPES.REMAINING_USEFUL_LIFE]: {
      isCompatible: Boolean(timeRange && timeRange.durationSeconds >= 300),
      reason: timeRange && timeRange.durationSeconds >= 300
        ? `Recorded continuous operating horizon (${timeRange.durationSeconds}s) supports wear-rate forecasting.`
        : 'Horizon too brief (< 300s) for trend-based RUL prognostic estimation.',
      recommendedModel: 'Kinematic Wear Degradation Estimator'
    }
  };

  return {
    delimiter,
    headers,
    totalRows,
    totalColumns: headers.length,
    columns,
    previewRows,
    qualityFindings,
    labelDistribution,
    modality,
    timeRange,
    samplingRateHz,
    samplingIntervalMeanMs,
    aiTaskCompatibility,
    candidateMappings
  };
}
