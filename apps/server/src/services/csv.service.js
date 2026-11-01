import { GEARBOX_SIGNALS } from '@predictive-maintenance/shared';

/**
 * Detect delimiter by counting frequency in first non-empty lines.
 */
export function detectDelimiter(textSample) {
  const lines = textSample.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ',';

  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const line of lines) {
    counts[','] += (line.match(/,/g) || []).length;
    counts[';'] += (line.match(/;/g) || []).length;
    counts['\t'] += (line.match(/\t/g) || []).length;
  }

  let bestDelimiter = ',';
  let maxCount = -1;
  for (const [delim, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delim;
    }
  }

  return maxCount > 0 ? bestDelimiter : ',';
}

/**
 * Robust RFC 4180-compliant CSV row parser supporting quotes and escaped quotes.
 */
export function parseCsvLine(line, delimiter = ',') {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse entire CSV content and profile headers and preview.
 */
export function parseAndProfileCsv(contentString, options = {}) {
  if (!contentString || contentString.trim().length === 0) {
    const err = new Error('The uploaded file is empty.');
    err.status = 400;
    err.code = 'EMPTY_FILE';
    throw err;
  }

  const delimiter = options.delimiter || detectDelimiter(contentString.slice(0, 4096));
  const lines = contentString.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    const err = new Error('CSV file must contain a header row and at least one data row.');
    err.status = 400;
    err.code = 'INSUFFICIENT_ROWS';
    throw err;
  }

  const rawHeaders = parseCsvLine(lines[0], delimiter);
  const headerSet = new Set();
  const duplicateHeaders = [];

  for (let i = 0; i < rawHeaders.length; i++) {
    const h = rawHeaders[i];
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
  }

  if (duplicateHeaders.length > 0) {
    const err = new Error(`CSV file contains duplicate headers: ${duplicateHeaders.join(', ')}`);
    err.status = 400;
    err.code = 'DUPLICATE_HEADERS';
    throw err;
  }

  // Parse data rows
  const parsedRows = [];
  const malformedRows = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i], delimiter);
    if (fields.length !== rawHeaders.length) {
      malformedRows.push({
        line: i + 1,
        expectedCols: rawHeaders.length,
        actualCols: fields.length
      });
      if (malformedRows.length >= 10) break; // Limit reporting
    } else {
      const rowObj = {};
      for (let c = 0; c < rawHeaders.length; c++) {
        rowObj[rawHeaders[c]] = fields[c];
      }
      parsedRows.push(rowObj);
    }
  }

  if (malformedRows.length > 0) {
    const err = new Error(
      `Malformed CSV rows detected (e.g. Line ${malformedRows[0].line} has ${malformedRows[0].actualCols} columns instead of ${malformedRows[0].expectedCols}).`
    );
    err.status = 400;
    err.code = 'MALFORMED_ROW';
    err.details = malformedRows;
    throw err;
  }

  // Suggest candidate mappings
  const candidateMappings = rawHeaders.map((header) => {
    const lower = header.toLowerCase();
    let isTimestamp = false;
    let isLabel = false;
    let mappedSignal = null;
    let suggestedUnit = null;

    if (/(time|date|timestamp|ts|epoch|datetime)/i.test(lower)) {
      isTimestamp = true;
    } else if (/(label|fault|class|health|defect|status|mode|state)/i.test(lower)) {
      isLabel = true;
    } else {
      // Check against standard signals
      if (/input.*axial.*vib|vib.*axial.*in|accel.*in.*ax/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.VIBRATION_INPUT_AXIAL.key;
        suggestedUnit = GEARBOX_SIGNALS.VIBRATION_INPUT_AXIAL.standardUnit;
      } else if (/input.*rad.*vib|vib.*rad.*in|accel.*in.*rad/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.VIBRATION_INPUT_RADIAL.key;
        suggestedUnit = GEARBOX_SIGNALS.VIBRATION_INPUT_RADIAL.standardUnit;
      } else if (/output.*rad.*vib|vib.*rad.*out|accel.*out/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.VIBRATION_OUTPUT_RADIAL.key;
        suggestedUnit = GEARBOX_SIGNALS.VIBRATION_OUTPUT_RADIAL.standardUnit;
      } else if (/sump.*temp|oil.*temp|temp.*sump/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.TEMPERATURE_GEARBOX_SUMP.key;
        suggestedUnit = GEARBOX_SIGNALS.TEMPERATURE_GEARBOX_SUMP.standardUnit;
      } else if (/bearing.*temp|temp.*bearing/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.TEMPERATURE_BEARING.key;
        suggestedUnit = GEARBOX_SIGNALS.TEMPERATURE_BEARING.standardUnit;
      } else if (/speed|rpm|rotat/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.ROTATIONAL_SPEED.key;
        suggestedUnit = GEARBOX_SIGNALS.ROTATIONAL_SPEED.standardUnit;
      } else if (/torque|load|nm/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.LOAD_TORQUE.key;
        suggestedUnit = GEARBOX_SIGNALS.LOAD_TORQUE.standardUnit;
      } else if (/vib|accel/i.test(lower)) {
        mappedSignal = GEARBOX_SIGNALS.VIBRATION_INPUT_RADIAL.key;
        suggestedUnit = 'mm/s';
      }
    }

    return {
      rawHeader: header,
      isTimestamp,
      isLabel,
      mappedSignal,
      suggestedUnit
    };
  });

  return {
    delimiter,
    headers: rawHeaders,
    totalRows: parsedRows.length,
    totalColumns: rawHeaders.length,
    candidateMappings,
    previewRows: parsedRows.slice(0, 10),
    allRows: parsedRows
  };
}

