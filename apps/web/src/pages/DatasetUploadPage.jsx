import React, { useState } from 'react';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import { DEMO_MACHINES, GEARBOX_SIGNALS } from '@predictive-maintenance/shared';

/**
 * DatasetUploadPage: CSV ingestion, sensor column/unit mapping, and data quality preview shell.
 */
export default function DatasetUploadPage() {
  const [selectedMachine, setSelectedMachine] = useState('GB-104');
  const [datasetType, setDatasetType] = useState('operational');
  const [isDragOver, setIsDragOver] = useState(false);

  // Demo mapping preview rows
  const demoMappings = [
    { csvColumn: 'timestamp_utc', mappedSignal: 'Timestamp', unit: 'ISO-8601', status: 'valid' },
    { csvColumn: 'vib_pinion_radial_mms', mappedSignal: GEARBOX_SIGNALS.VIBRATION_INPUT_RADIAL.label, unit: 'mm/s', status: 'valid' },
    { csvColumn: 'vib_pinion_axial_mms', mappedSignal: GEARBOX_SIGNALS.VIBRATION_INPUT_AXIAL.label, unit: 'mm/s', status: 'valid' },
    { csvColumn: 'temp_sump_celsius', mappedSignal: GEARBOX_SIGNALS.TEMPERATURE_GEARBOX_SUMP.label, unit: '°C', status: 'valid' },
    { csvColumn: 'temp_bearing_de_c', mappedSignal: GEARBOX_SIGNALS.TEMPERATURE_BEARING.label, unit: '°C', status: 'valid' },
    { csvColumn: 'shaft_speed_rpm', mappedSignal: GEARBOX_SIGNALS.ROTATIONAL_SPEED.label, unit: 'RPM', status: 'valid' },
    { csvColumn: 'load_torque_nm', mappedSignal: GEARBOX_SIGNALS.LOAD_TORQUE.label, unit: 'Nm', status: 'valid' }
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dataset Ingestion & Validation</h1>
          <p className="page-subtitle">
            Upload raw historical gearbox sensor readings (CSV), map transducer channels, and verify data quality before analysis.
          </p>
        </div>
      </div>

      {/* Target Equipment & Provenance Selection */}
      <div className="grid-two-col">
        <Card
          title="1. Equipment & Provenance Metadata"
          subtitle="Associate dataset with target gearbox and distinguish operational from research data"
        >
          <div className="form-group">
            <label className="form-label" htmlFor="machine-select">Target Monitored Machine:</label>
            <select
              id="machine-select"
              className="form-select"
              value={selectedMachine}
              onChange={(e) => setSelectedMachine(e.target.value)}
            >
              {DEMO_MACHINES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.name} ({m.model})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Dataset Provenance Category:</label>
            <div className="provenance-radio-group">
              <label className="radio-card">
                <input
                  type="radio"
                  name="datasetType"
                  value="operational"
                  checked={datasetType === 'operational'}
                  onChange={() => setDatasetType('operational')}
                />
                <div className="radio-card-content">
                  <span className="radio-title">Operational Run</span>
                  <span className="radio-desc">Field telemetry from live industrial operation</span>
                </div>
              </label>

              <label className="radio-card">
                <input
                  type="radio"
                  name="datasetType"
                  value="benchmark"
                  checked={datasetType === 'benchmark'}
                  onChange={() => setDatasetType('benchmark')}
                />
                <div className="radio-card-content">
                  <span className="radio-title">Research Benchmark</span>
                  <span className="radio-desc">Controlled laboratory run with known ground-truth labels</span>
                </div>
              </label>

              <label className="radio-card">
                <input
                  type="radio"
                  name="datasetType"
                  value="simulated"
                  checked={datasetType === 'simulated'}
                  onChange={() => setDatasetType('simulated')}
                />
                <div className="radio-card-content">
                  <span className="radio-title">Synthetic / Simulated</span>
                  <span className="radio-desc">Dynamical testbed or simulator dataset (labeled simulated)</span>
                </div>
              </label>
            </div>
          </div>
        </Card>

        {/* Upload Dropzone */}
        <Card
          title="2. Select Sensor Dataset File"
          subtitle="Supports standard CSV with timestamp and numerical sensor columns"
        >
          <div
            className={`upload-dropzone ${isDragOver ? 'dropzone-active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); }}
          >
            <div className="dropzone-icon" aria-hidden="true">📁</div>
            <div className="dropzone-title">Drag & drop gearbox CSV file here</div>
            <div className="dropzone-subtitle">or click to browse local filesystem</div>
            <div className="dropzone-meta">
              Max file size: 50MB • Required: monotonic timestamp column
            </div>
            <Button variant="secondary" size="sm" className="dropzone-btn">
              Browse Files (Demo Shell)
            </Button>
          </div>
          <div className="sim-notice-inline">
            <span className="badge badge-demo">PHASE 2 SHELL</span>
            <span>File upload pipeline and local disk storage adapter will be activated in Phase 5.</span>
          </div>
        </Card>
      </div>

      {/* Signal Mapping Preview Card */}
      <Card
        title="3. Column & Physical Unit Mapping Preview"
        subtitle="Map source CSV column headers to normalized domain signals and engineering units"
        badge={<StatusBadge status="info" label="Sample Specimen Mapping" isSimulated={true} />}
      >
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Source CSV Header</th>
                <th scope="col">Mapped Gearbox Signal</th>
                <th scope="col">Transducer Unit</th>
                <th scope="col">Mapping Validation</th>
              </tr>
            </thead>
            <tbody>
              {demoMappings.map((row, idx) => (
                <tr key={idx}>
                  <td><span className="mono-code">{row.csvColumn}</span></td>
                  <td className="table-primary-text">{row.mappedSignal}</td>
                  <td><span className="mono-code">{row.unit}</span></td>
                  <td>
                    <StatusBadge status="healthy" label="MATCHED" isSimulated={true} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pre-flight Data Quality Inspection Checklist */}
      <Card
        title="4. Data Quality & Integrity Validation Criteria"
        subtitle="Verification rules executed on the backend before running anomaly detection models"
      >
        <div className="validation-checks-grid">
          <div className="check-item">
            <span className="check-icon">✓</span>
            <div>
              <div className="check-title">Timestamp Monotonicity</div>
              <div className="check-desc">Ensures timestamps strictly increase without duplicate epochs or backwards jumps.</div>
            </div>
          </div>
          <div className="check-item">
            <span className="check-icon">✓</span>
            <div>
              <div className="check-title">Sampling Interval Continuity</div>
              <div className="check-desc">Identifies communication gaps or dropped packets (&gt;500ms intervals flagged).</div>
            </div>
          </div>
          <div className="check-item">
            <span className="check-icon">✓</span>
            <div>
              <div className="check-title">Sensor Range Sanity Bounds</div>
              <div className="check-desc">Validates signals against physical limits (e.g. Sump Temp: -20°C to +140°C).</div>
            </div>
          </div>
          <div className="check-item">
            <span className="check-icon">✓</span>
            <div>
              <div className="check-title">Missing Value & Null Rates</div>
              <div className="check-desc">Reports missingness percentage per channel; flags files exceeding 2% missing values.</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
