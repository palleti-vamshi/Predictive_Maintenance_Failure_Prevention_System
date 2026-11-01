import {
  GEARBOX_SIGNAL_BOUNDS,
  DATASET_MODALITY,
  AI_TASK_TYPES,
  DATASET_STATUS
} from '@predictive-maintenance/shared';

/**
 * Validate parsed CSV rows against column mappings and engineering standards.
 */
export function validateDatasetContent(rows, columnMappings) {
  const qualityFindings = [];
  const processedColumns = [];
  let timeColumn = null;
  let labelColumn = null;
  const numericColumns = [];

  // Group columns by mapping intent
  for (const mapping of columnMappings) {
    if (mapping.isTimestamp) {
      timeColumn = mapping;
    } else if (mapping.isLabel) {
      labelColumn = mapping;
    } else if (mapping.mappedSignal) {
      numericColumns.push(mapping);
    }
  }

  // 1. Validate Timestamps
  let timeRange = null;
  let samplingRateHz = null;
  let samplingIntervalMeanMs = null;

  if (timeColumn) {
    const rawColName = timeColumn.rawHeader;
    const timestamps = [];
    let invalidTimestamps = 0;
    let duplicateTimestamps = 0;
    let outOfOrderCount = 0;
    const seenTimes = new Set();

    for (let r = 0; r < rows.length; r++) {
      const val = rows[r][rawColName];
      if (!val || val.trim() === '') {
        invalidTimestamps++;
        continue;
      }

      // Support Unix epoch numeric seconds/ms, ISO/Date string, or relative elapsed seconds
      let parsedDate;
      const trimmed = val.trim();
      if (/^\d{10,13}$/.test(trimmed)) {
        const num = parseInt(trimmed, 10);
        parsedDate = new Date(num > 1e11 ? num : num * 1000);
      } else if (/^\d+(\.\d+)?$/.test(trimmed)) {
        // Relative elapsed seconds (e.g. 0.12, 1.5, 72.28 from dyno/simulator recordings)
        const elapsedSec = parseFloat(trimmed);
        parsedDate = new Date(Math.round(elapsedSec * 1000));
      } else {
        parsedDate = new Date(trimmed);
      }

      if (isNaN(parsedDate.getTime())) {
        invalidTimestamps++;
        continue;
      }

      const timeVal = parsedDate.getTime();
      if (seenTimes.has(timeVal)) {
        duplicateTimestamps++;
      }
      seenTimes.add(timeVal);

      if (timestamps.length > 0) {
        const prevTime = timestamps[timestamps.length - 1];
        if (timeVal < prevTime) {
          outOfOrderCount++;
        }
      }
      timestamps.push(timeVal);
    }

    if (invalidTimestamps > 0) {
      qualityFindings.push({
        severity: 'error',
        code: 'INVALID_TIMESTAMP_FORMAT',
        message: `${invalidTimestamps} rows contain unparseable or missing timestamps in column "${rawColName}".`,
        column: rawColName,
        affectedCount: invalidTimestamps
      });
    }

    if (outOfOrderCount > 0) {
      qualityFindings.push({
        severity: 'warning',
        code: 'OUT_OF_ORDER_TIMESTAMPS',
        message: `Detected ${outOfOrderCount} non-monotonic/out-of-order timestamps. Sequence sorting recommended.`,
        column: rawColName,
        affectedCount: outOfOrderCount
      });
    }

    if (duplicateTimestamps > 0) {
      qualityFindings.push({
        severity: 'warning',
        code: 'DUPLICATE_TIMESTAMPS',
        message: `Detected ${duplicateTimestamps} duplicate timestamp entries in column "${rawColName}".`,
        column: rawColName,
        affectedCount: duplicateTimestamps
      });
    }

    if (timestamps.length >= 2) {
      const sortedTimes = [...timestamps].sort((a, b) => a - b);
      const startTime = new Date(sortedTimes[0]);
      const endTime = new Date(sortedTimes[sortedTimes.length - 1]);
      const durationSeconds = Math.max(0, (endTime.getTime() - startTime.getTime()) / 1000);

      timeRange = {
        start: startTime,
        end: endTime,
        durationSeconds
      };

      // Compute intervals between consecutive timestamps
      const intervals = [];
      for (let i = 1; i < timestamps.length; i++) {
        const diff = timestamps[i] - timestamps[i - 1];
        if (diff > 0) intervals.push(diff);
      }

      if (intervals.length > 0) {
        const sum = intervals.reduce((acc, v) => acc + v, 0);
        samplingIntervalMeanMs = sum / intervals.length;
        if (samplingIntervalMeanMs > 0) {
          samplingRateHz = Math.round((1000 / samplingIntervalMeanMs) * 100) / 100;
        }

        // Check for temporal gaps (> 3x mean interval)
        const gapCount = intervals.filter((d) => d > 3 * samplingIntervalMeanMs).length;
        if (gapCount > 0) {
          qualityFindings.push({
            severity: 'info',
            code: 'SAMPLING_GAPS_DETECTED',
            message: `Detected ${gapCount} transmission/sampling gaps exceeding 3x the nominal interval (${Math.round(samplingIntervalMeanMs)} ms).`,
            column: rawColName,
            affectedCount: gapCount
          });
        }
      }
    }

    processedColumns.push({
      rawHeader: rawColName,
      mappedSignal: 'timestamp',
      isTimestamp: true,
      isLabel: false,
      sourceUnit: 'datetime',
      targetUnit: 'ISO8601',
      dataType: 'datetime',
      stats: {
        missingCount: invalidTimestamps,
        missingPct: Math.round((invalidTimestamps / rows.length) * 1000) / 10,
        outOfBoundsCount: outOfOrderCount
      }
    });
  }

  // 2. Validate Numeric Signal Columns
  for (const col of numericColumns) {
    const rawColName = col.rawHeader;
    const signalKey = col.mappedSignal;
    const bounds = GEARBOX_SIGNAL_BOUNDS[signalKey] || null;

    let missingCount = 0;
    let nonNumericCount = 0;
    let outOfBoundsCount = 0;
    let infiniteCount = 0;
    let sum = 0;
    let validCount = 0;
    let minVal = Infinity;
    let maxVal = -Infinity;

    for (let r = 0; r < rows.length; r++) {
      const rawVal = rows[r][rawColName];
      if (rawVal === undefined || rawVal === null || rawVal.toString().trim() === '') {
        missingCount++;
        continue;
      }

      const num = Number(rawVal);
      if (isNaN(num)) {
        nonNumericCount++;
        continue;
      }

      if (!isFinite(num)) {
        infiniteCount++;
        continue;
      }

      validCount++;
      sum += num;
      if (num < minVal) minVal = num;
      if (num > maxVal) maxVal = num;

      if (bounds) {
        if (num < bounds.min || num > bounds.max) {
          outOfBoundsCount++;
        }
      }
    }

    const missingPct = Math.round(((missingCount + nonNumericCount) / rows.length) * 1000) / 10;
    const meanVal = validCount > 0 ? Math.round((sum / validCount) * 100) / 100 : null;

    if (missingPct > 20) {
      qualityFindings.push({
        severity: 'error',
        code: 'HIGH_MISSING_VALUES',
        message: `Column "${rawColName}" has ${missingPct}% missing or invalid values (exceeds 20% tolerance).`,
        column: rawColName,
        affectedCount: missingCount + nonNumericCount
      });
    } else if (missingPct > 5) {
      qualityFindings.push({
        severity: 'warning',
        code: 'ELEVATED_MISSING_VALUES',
        message: `Column "${rawColName}" has ${missingPct}% missing values.`,
        column: rawColName,
        affectedCount: missingCount
      });
    }

    if (infiniteCount > 0) {
      qualityFindings.push({
        severity: 'error',
        code: 'INFINITE_VALUES',
        message: `Column "${rawColName}" contains ${infiniteCount} non-finite/Infinity values.`,
        column: rawColName,
        affectedCount: infiniteCount
      });
    }

    if (outOfBoundsCount > 0 && bounds) {
      qualityFindings.push({
        severity: 'warning',
        code: 'OUT_OF_BOUNDS_VALUES',
        message: `Column "${rawColName}" has ${outOfBoundsCount} values outside expected physical range [${bounds.min}, ${bounds.max} ${bounds.unit}].`,
        column: rawColName,
        affectedCount: outOfBoundsCount
      });
    }

    processedColumns.push({
      rawHeader: rawColName,
      mappedSignal: signalKey,
      isTimestamp: false,
      isLabel: false,
      sourceUnit: col.sourceUnit || (bounds ? bounds.unit : 'unitless'),
      targetUnit: col.targetUnit || (bounds ? bounds.unit : 'unitless'),
      dataType: 'numeric',
      stats: {
        missingCount: missingCount + nonNumericCount,
        missingPct,
        min: isFinite(minVal) ? Math.round(minVal * 100) / 100 : null,
        max: isFinite(maxVal) ? Math.round(maxVal * 100) / 100 : null,
        mean: meanVal,
        outOfBoundsCount
      }
    });
  }

  // 3. Validate Labels and Class Balance
  const labelDistribution = {};
  if (labelColumn) {
    const rawColName = labelColumn.rawHeader;
    let missingLabels = 0;

    for (let r = 0; r < rows.length; r++) {
      const val = rows[r][rawColName];
      if (val === undefined || val === null || val.toString().trim() === '') {
        missingLabels++;
        continue;
      }
      const labelKey = val.toString().trim();
      labelDistribution[labelKey] = (labelDistribution[labelKey] || 0) + 1;
    }

    const classes = Object.keys(labelDistribution);
    if (classes.length < 2) {
      qualityFindings.push({
        severity: 'warning',
        code: 'SINGLE_CLASS_LABEL',
        message: `Label column "${rawColName}" contains only 1 distinct class (${classes[0] || 'none'}). Fault classification requires at least 2 distinct classes.`,
        column: rawColName,
        affectedCount: rows.length
      });
    } else {
      // Check for class imbalance (< 5% representation)
      for (const [cls, count] of Object.entries(labelDistribution)) {
        const pct = (count / rows.length) * 100;
        if (pct < 5) {
          qualityFindings.push({
            severity: 'info',
            code: 'SEVERE_CLASS_IMBALANCE',
            message: `Class "${cls}" represents only ${Math.round(pct * 10) / 10}% of samples (${count}/${rows.length}). Resampling or class-weighted algorithms recommended.`,
            column: rawColName,
            affectedCount: count
          });
        }
      }
    }

    processedColumns.push({
      rawHeader: rawColName,
      mappedSignal: 'label',
      isTimestamp: false,
      isLabel: true,
      sourceUnit: 'class',
      targetUnit: 'categorical',
      dataType: 'string',
      stats: {
        missingCount: missingLabels,
        missingPct: Math.round((missingLabels / rows.length) * 1000) / 10,
        outOfBoundsCount: 0
      }
    });
  }

  // 4. Modality Determination
  let detectedModality = DATASET_MODALITY.UNLABELED_TELEMETRY;
  const labelClasses = Object.keys(labelDistribution);

  if (/rul|remaining_life|time_to_failure/i.test(JSON.stringify(columnMappings))) {
    detectedModality = DATASET_MODALITY.RUN_TO_FAILURE;
  } else if (labelClasses.length >= 2) {
    detectedModality = DATASET_MODALITY.LABELED_FAULTS;
  } else if (samplingRateHz && samplingRateHz >= 100) {
    detectedModality = DATASET_MODALITY.RAW_SIGNALS;
  } else if (
    numericColumns.some((c) => /rms|kurtosis|crest|peak|skewness/i.test(c.rawHeader))
  ) {
    detectedModality = DATASET_MODALITY.PRECOMPUTED_FEATURES;
  }

  // 5. AI Task Compatibility Assessment
  const validSignalsCount = processedColumns.filter((c) => c.mappedSignal && !c.isTimestamp && !c.isLabel).length;
  const hasErrors = qualityFindings.some((f) => f.severity === 'error');

  // Anomaly Detection Compatibility
  let anomalyCompatible = false;
  let anomalyReason = '';
  if (rows.length < 100) {
    anomalyReason = `Insufficient observations (${rows.length} rows; minimum 100 required for baseline density estimation).`;
  } else if (validSignalsCount === 0) {
    anomalyReason = 'No sensor signals mapped to gearbox profile.';
  } else if (hasErrors) {
    anomalyReason = 'Dataset contains fatal data quality errors.';
  } else {
    anomalyCompatible = true;
    anomalyReason = `Compatible: ${rows.length} observations with ${validSignalsCount} mapped telemetry signals suitable for unsupervised boundary modeling.`;
  }

  // Fault Classification Compatibility
  let classificationCompatible = false;
  let classificationReason = '';
  if (labelClasses.length < 2) {
    classificationReason =
      'Incompatible: No discrete ground-truth fault label column mapped with at least 2 distinct failure/healthy classes.';
  } else if (validSignalsCount === 0) {
    classificationReason = 'Incompatible: No sensor feature or vibration signals mapped to train classifiers.';
  } else if (rows.length < 50) {
    classificationReason = `Insufficient labeled examples (${rows.length} rows; minimum 50 recommended for supervised cross-validation).`;
  } else {
    classificationCompatible = true;
    classificationReason = `Compatible: ${rows.length} samples with ${labelClasses.length} distinct classes (${labelClasses.join(', ')}) mapped to ${validSignalsCount} signals.`;
  }

  // Remaining Useful Life (RUL) Prognosis Compatibility
  let rulCompatible = false;
  let rulReason = '';
  if (detectedModality === DATASET_MODALITY.RUN_TO_FAILURE) {
    rulCompatible = true;
    rulReason = 'Compatible: Run-to-failure degradation trajectory with temporal progression to failure.';
  } else if (rows.length >= 500 && timeRange && timeRange.durationSeconds >= 3600 && validSignalsCount >= 2) {
    rulCompatible = true;
    rulReason = `Compatible: Extended time series (${Math.round(timeRange.durationSeconds / 3600)} hrs) with continuous telemetry suitable for degradation trend fitting.`;
  } else {
    rulReason =
      'Incompatible: Lacks continuous time-to-failure targets, end-of-life termination criteria, or extended run-to-failure trajectory.';
  }

  const aiTaskCompatibility = {
    [AI_TASK_TYPES.ANOMALY_DETECTION]: {
      isCompatible: anomalyCompatible,
      reason: anomalyReason,
      recommendedModel: 'Isolation Forest / Autoencoder (Unsupervised Outlier Detection)'
    },
    [AI_TASK_TYPES.FAULT_CLASSIFICATION]: {
      isCompatible: classificationCompatible,
      reason: classificationReason,
      recommendedModel: 'Random Forest Multi-Class Classifier / Gradient Boosted Trees'
    },
    [AI_TASK_TYPES.REMAINING_USEFUL_LIFE]: {
      isCompatible: rulCompatible,
      reason: rulReason,
      recommendedModel: 'Weibull Hazard / Temporal RUL Regressor'
    }
  };

  // Determine overall dataset status
  let finalStatus = DATASET_STATUS.READY;
  if (hasErrors) {
    finalStatus = DATASET_STATUS.REJECTED;
  } else if (qualityFindings.some((f) => f.severity === 'warning')) {
    finalStatus = DATASET_STATUS.NEEDS_REVIEW;
  }

  return {
    status: finalStatus,
    modality: detectedModality,
    timeRange,
    samplingRateHz,
    samplingIntervalMeanMs,
    columns: processedColumns,
    qualityFindings,
    labelDistribution,
    aiTaskCompatibility
  };
}

