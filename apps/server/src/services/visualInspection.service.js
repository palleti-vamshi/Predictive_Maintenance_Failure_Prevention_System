/**
 * MechGuard AI — External Casing Visual Inspection Service
 * 
 * Provides automated computer vision assistance for physical work order inspections.
 * Strictly bounded to external casing anomalies (surface corrosion, fluid leakage,
 * seal seepage, casing abrasions).
 * 
 * TRUTHFULNESS & ACCURACY POLICY:
 * Computer vision can ONLY inspect external visual surfaces.
 * It CANNOT diagnose internal rotating machinery, gear meshing, bearing raceways,
 * or fatigue cracking without acoustic/vibration telemetry and internal borescope inspection.
 */

export const VISUAL_INSPECTION_DISCLAIMER =
  'Visual Inspection Boundary: Automated computer vision defect classification is disabled pending deployment of a validated, calibrated neural vision model. Photos are archived for physical review and audit logging. Visual inspection CANNOT diagnose internal gearbox, bearing, or gear-tooth health. On-site physical verification by an authorized technician is mandatory.';

/**
 * Analyze an uploaded inspection photo for external casing surface anomalies.
 * Validates image integrity and magic bytes, extracts structural dimensions.
 * Disables automated findings and confidence on real images until a calibrated vision model is deployed.
 * Supports explicit simulated defect stubs for workflow and permission testing.
 * 
 * @param {Buffer} imageBuffer - Raw binary buffer of the uploaded image
 * @param {Object} options - Metadata options (filename, machineCode, componentType, simulateDefect)
 * @returns {Promise<Object>} Structured visual inspection record with honest boundaries
 */
export async function analyzeInspectionPhoto(imageBuffer, options = {}) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 16) {
    throw new Error('Invalid image buffer provided for visual inspection.');
  }

  // 1. Detect image format from magic bytes and reject unknown payloads
  let format = 'unknown';
  if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff) {
    format = 'jpeg';
  } else if (
    imageBuffer[0] === 0x89 &&
    imageBuffer[1] === 0x50 &&
    imageBuffer[2] === 0x4e &&
    imageBuffer[3] === 0x47
  ) {
    format = 'png';
  } else if (
    imageBuffer.length >= 12 &&
    imageBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    imageBuffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    format = 'webp';
  }

  if (format === 'unknown') {
    throw new Error('Unsupported or corrupt image payload. Only valid JPEG, PNG, and WebP images are supported for visual inspection.');
  }

  // 2. Safe image dimensions extraction from container headers
  let width = null;
  let height = null;
  try {
    if (format === 'png' && imageBuffer.length >= 24) {
      width = imageBuffer.readUInt32BE(16);
      height = imageBuffer.readUInt32BE(20);
    } else if (format === 'jpeg' && imageBuffer.length >= 4) {
      let offset = 2;
      while (offset < imageBuffer.length - 8) {
        if (imageBuffer[offset] === 0xff) {
          const marker = imageBuffer[offset + 1];
          if (marker >= 0xc0 && marker <= 0xc3 && marker !== 0xc4) {
            height = imageBuffer.readUInt16BE(offset + 5);
            width = imageBuffer.readUInt16BE(offset + 7);
            break;
          } else if (marker === 0xda || marker === 0xd9) {
            break;
          } else {
            const len = imageBuffer.readUInt16BE(offset + 2);
            offset += 2 + len;
          }
        } else {
          offset++;
        }
      }
    } else if (format === 'webp' && imageBuffer.length >= 30) {
      if (imageBuffer.subarray(12, 16).toString('ascii') === 'VP8 ') {
        width = imageBuffer.readUInt16LE(26) & 0x3fff;
        height = imageBuffer.readUInt16LE(28) & 0x3fff;
      }
    }
  } catch {
    // Dimension extraction failure is non-fatal for valid containers
  }

  const fileSizeBytes = imageBuffer.length;

  // 3. Automated Defect Findings & Confidence Policy:
  // Real computer vision findings are disabled until a validated, calibrated vision model is integrated.
  // Workflow tests can explicitly supply `options.simulateDefect` to test approval and feedback transitions.
  if (options.simulateDefect) {
    const isCorrosion = options.simulateDefect === 'corrosion';
    return {
      defectDetected: true,
      findings: [
        {
          category: isCorrosion ? 'Surface Corrosion / Oxidation' : 'Fluid Sheen / Seal Seepage',
          confidence: null, // Confidence disabled to avoid pseudo-scientific scoring
          severity: 'minor',
          description: `Simulated casing ${isCorrosion ? 'corrosion' : 'fluid weeping'} finding generated for workflow approval and feedback verification.`
        }
      ],
      analysisMethod: 'synthetic_simulation_stub',
      overallConfidence: null,
      uncertaintyLevel: 'Uncalibrated',
      format,
      dimensions: width && height ? { width, height } : null,
      fileSizeBytes,
      disclaimer: VISUAL_INSPECTION_DISCLAIMER,
      recommendation: 'Technician verification required: Confirm simulated casing finding on-site.'
    };
  }

  // Real production image upload without simulated defect:
  // Automated findings and confidence scores are disabled to prevent ungrounded AI diagnosis.
  return {
    defectDetected: false,
    findings: [],
    analysisMethod: 'automated_vision_disabled',
    overallConfidence: null,
    uncertaintyLevel: 'Uncalibrated',
    format,
    dimensions: width && height ? { width, height } : null,
    fileSizeBytes,
    disclaimer: VISUAL_INSPECTION_DISCLAIMER,
    recommendation: 'Physical technician visual inspection required: inspect visible casing, seals, and fittings on-site.'
  };
}

