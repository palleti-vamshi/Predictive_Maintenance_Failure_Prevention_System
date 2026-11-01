import React, { useState, useEffect, useRef } from 'react';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../router/Router.jsx';
import {
  GEARBOX_SIGNALS,
  DATASET_TYPES,
  DATASET_STATUS,
  AI_TASK_TYPES,
  USER_ROLES
} from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function DatasetUploadPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();

  // Wizard state
  const [datasetType, setDatasetType] = useState(DATASET_TYPES.OPERATIONAL);
  const [machines, setMachines] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Reference dataset specific fields
  const [refDetails, setRefDetails] = useState({
    sourceName: '',
    sourceUrl: '',
    citation: '',
    license: '',
    usageTerms: '',
    machineType: 'Industrial Multi-Stage Gearbox',
    operatingConditions: '',
    labelDefinitions: '',
    knownLimitations: '',
    userConfirmedTerms: false
  });

  // File & Upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploadedSession, setUploadedSession] = useState(null);

  // Column Mappings state
  const [columnMappings, setColumnMappings] = useState([]);

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState(null);

  // Ingestion confirmation state
  const [confirming, setConfirming] = useState(false);
  const [confirmedDataset, setConfirmedDataset] = useState(null);

  // Ingested datasets list
  const [recentDatasets, setRecentDatasets] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const fileInputRef = useRef(null);

  // Fetch accessible machines and recent datasets
  useEffect(() => {
    async function loadInitialData() {
      try {
        const token = user?.sessionToken || localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        // Fetch scoped machines
        const mRes = await fetch(`${API_BASE}/machines`, { credentials: 'include', headers });
        if (mRes.ok) {
          const mData = await mRes.json();
          setMachines(mData.machines || []);
          if (mData.machines?.length > 0 && !selectedMachineId) {
            setSelectedMachineId(mData.machines[0]._id);
          }
        }

        // Fetch recent datasets
        loadRecentDatasets();
      } catch (err) {
        console.error('Failed to load initial upload data:', err);
      }
    }
    loadInitialData();
  }, [user]);

  async function loadRecentDatasets() {
    try {
      setLoadingRecent(true);
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/datasets`, { credentials: 'include', headers });
      if (res.ok) {
        const data = await res.json();
        setRecentDatasets(data.datasets || []);
      }
    } catch (err) {
      console.error('Failed to load datasets list:', err);
    } finally {
      setLoadingRecent(false);
    }
  }

  // Handle file drop / select
  function handleFileSelect(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      setUploadError('Invalid file format. Only standard CSV (.csv, .txt) files are accepted.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError('File exceeds the 25 MB limit.');
      return;
    }
    setUploadError(null);
    setSelectedFile(file);
    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
    }
  }

  // Execute File Upload
  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setUploadProgress(20);
    setUploadError(null);

    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const formData = new FormData();
      formData.append('file', selectedFile);

      setUploadProgress(50);
      const res = await fetch(`${API_BASE}/datasets/upload`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData
      });

      setUploadProgress(90);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'File upload failed');
      }

      setUploadProgress(100);
      setUploadedSession(data);

      // Initialize column mappings from candidate detections
      const initialMappings = data.headers.map((h) => {
        const candidate = data.candidateMappings?.find((c) => c.rawHeader === h);
        return {
          rawHeader: h,
          mappedSignal: candidate?.mappedSignal || null,
          isTimestamp: Boolean(candidate?.isTimestamp),
          isLabel: Boolean(candidate?.isLabel),
          sourceUnit: candidate?.suggestedUnit || ''
        };
      });
      setColumnMappings(initialMappings);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError(err.message || 'File upload failed.');
    } finally {
      setUploading(false);
    }
  }

  // Update a column mapping
  function updateMapping(rawHeader, field, value) {
    setColumnMappings((prev) =>
      prev.map((m) => {
        if (m.rawHeader !== rawHeader) return m;

        if (field === 'role') {
          if (value === 'timestamp') {
            return { ...m, isTimestamp: true, isLabel: false, mappedSignal: null, sourceUnit: 'ISO8601' };
          }
          if (value === 'label') {
            return { ...m, isTimestamp: false, isLabel: true, mappedSignal: null, sourceUnit: 'class' };
          }
          if (value === 'unmapped') {
            return { ...m, isTimestamp: false, isLabel: false, mappedSignal: null, sourceUnit: '' };
          }
          // Gearbox signal key
          const sig = Object.values(GEARBOX_SIGNALS).find((s) => s.key === value);
          return {
            ...m,
            isTimestamp: false,
            isLabel: false,
            mappedSignal: value,
            sourceUnit: sig ? sig.standardUnit : ''
          };
        }

        return { ...m, [field]: value };
      })
    );
  }

  // Execute Validation
  async function handleValidate() {
    if (!uploadedSession?.uploadId) return;
    setValidating(true);
    setValidationError(null);

    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const res = await fetch(`${API_BASE}/datasets/validate`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          uploadId: uploadedSession.uploadId,
          columnMappings
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Validation failed');
      }

      setValidationResult(data.validation);
    } catch (err) {
      console.error('Validation error:', err);
      setValidationError(err.message || 'Dataset validation failed.');
    } finally {
      setValidating(false);
    }
  }

  // Execute Final Ingestion Confirmation
  async function handleConfirmIngestion() {
    if (!uploadedSession?.uploadId || !title.trim()) return;
    setConfirming(true);

    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const payload = {
        uploadId: uploadedSession.uploadId,
        datasetType,
        title: title.trim(),
        description: description.trim(),
        machineId: datasetType === DATASET_TYPES.OPERATIONAL ? selectedMachineId : null,
        columnMappings,
        referenceDetails: datasetType === DATASET_TYPES.REFERENCE ? refDetails : undefined
      };

      const res = await fetch(`${API_BASE}/datasets/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Ingestion confirmation failed');
      }

      setConfirmedDataset(data.dataset);
      loadRecentDatasets();
    } catch (err) {
      console.error('Confirmation error:', err);
      alert(err.message || 'Failed to confirm ingestion');
    } finally {
      setConfirming(false);
    }
  }

  // Reset wizard
  function handleReset() {
    setSelectedFile(null);
    setUploadedSession(null);
    setColumnMappings([]);
    setValidationResult(null);
    setConfirmedDataset(null);
    setTitle('');
    setDescription('');
  }

  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dataset Ingestion & Validation</h1>
          <p className="page-subtitle">
            Upload raw mechanical datasets, inspect CSV headers, map engineering signals, verify data quality, and assess model task compatibility.
          </p>
        </div>
        {confirmedDataset && (
          <Button variant="secondary" onClick={handleReset}>
            Upload Another Dataset
          </Button>
        )}
      </div>

      {confirmedDataset ? (
        /* Ingestion Success View */
        <Card
          title="Dataset Ingestion Confirmed"
          subtitle="File validated and registered in persistent factory records"
          badge={<StatusBadge status="healthy" label="READY" />}
        >
          <AlertCallout
            severity="healthy"
            title={`Successfully Ingested: ${confirmedDataset.title}`}
            description={`Dataset registered with ${confirmedDataset.totalRows} rows across ${confirmedDataset.columns?.length} mapped channels. Modality classified as "${confirmedDataset.modality}".`}
          />

          <div className="metrics-grid" style={{ marginTop: '1.25rem' }}>
            <div className="metric-box">
              <span className="metric-box-label">Modality Classification</span>
              <span className="metric-box-val" style={{ fontSize: '1.1rem' }}>{confirmedDataset.modality}</span>
              <span className="metric-box-sub">Schema v{confirmedDataset.dataSchemaVersion}</span>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Observations</span>
              <span className="metric-box-val">{confirmedDataset.totalRows.toLocaleString()}</span>
              <span className="metric-box-sub">Delimiter: &apos;{confirmedDataset.delimiter}&apos;</span>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Sampling Rate</span>
              <span className="metric-box-val">
                {confirmedDataset.samplingRateHz ? `${confirmedDataset.samplingRateHz} Hz` : 'N/A'}
              </span>
              <span className="metric-box-sub">
                {confirmedDataset.timeRange?.durationSeconds
                  ? `${Math.round(confirmedDataset.timeRange.durationSeconds / 60)} min duration`
                  : 'Static / Snapshot'}
              </span>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
            <Button
              variant="primary"
              onClick={() => {
                if (confirmedDataset.datasetType === DATASET_TYPES.OPERATIONAL && confirmedDataset.machineId) {
                  navigate(`#/machines/${confirmedDataset.machineId}`);
                } else {
                  navigate('#/research');
                }
              }}
            >
              {confirmedDataset.datasetType === DATASET_TYPES.OPERATIONAL ? 'View Machine Profile' : 'View Reference Catalog'}
            </Button>
            <Button variant="secondary" onClick={handleReset}>
              Upload New Dataset
            </Button>
          </div>
        </Card>
      ) : (
        /* Multi-Stage Upload Flow */
        <>
          {/* Stage 1: Target & Provenance Selection */}
          <div className="grid-two-col">
            <Card
              title="1. Dataset Provenance & Target Specimen"
              subtitle="Select operational equipment or register a research benchmark"
            >
              <div className="form-group">
                <label className="form-label">Dataset Provenance Category:</label>
                <div className="provenance-radio-group">
                  <label className="radio-card">
                    <input
                      type="radio"
                      name="datasetType"
                      value={DATASET_TYPES.OPERATIONAL}
                      checked={datasetType === DATASET_TYPES.OPERATIONAL}
                      onChange={() => setDatasetType(DATASET_TYPES.OPERATIONAL)}
                    />
                    <div className="radio-card-content">
                      <span className="radio-title">Operational Equipment Run</span>
                      <span className="radio-desc">Field telemetry from an authorized factory gearbox specimen</span>
                    </div>
                  </label>

                  <label className={`radio-card ${!isManager ? 'disabled-radio' : ''}`}>
                    <input
                      type="radio"
                      name="datasetType"
                      value={DATASET_TYPES.REFERENCE}
                      checked={datasetType === DATASET_TYPES.REFERENCE}
                      disabled={!isManager}
                      onChange={() => setDatasetType(DATASET_TYPES.REFERENCE)}
                    />
                    <div className="radio-card-content">
                      <span className="radio-title">Research / Benchmark Catalog</span>
                      <span className="radio-desc">
                        {isManager
                          ? 'Public or approved dataset for benchmarking and training'
                          : 'Manager only: Register public research benchmark'}
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {datasetType === DATASET_TYPES.OPERATIONAL ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="machine-target-select">
                    Target Factory Machine Specimen:
                  </label>
                  <select
                    id="machine-target-select"
                    className="form-select"
                    value={selectedMachineId}
                    onChange={(e) => setSelectedMachineId(e.target.value)}
                  >
                    {machines.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.code} — {m.name} ({m.model || 'Gearbox'}) [{m.operationalStatus}]
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                /* Reference Metadata Entry */
                <div className="reference-form-fields" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">Source Repository Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. NASA Ames PCoE / Case Western Reserve University"
                      value={refDetails.sourceName}
                      onChange={(e) => setRefDetails({ ...refDetails, sourceName: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Official Source URL (Metadata Reference Only) *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="https://..."
                      value={refDetails.sourceUrl}
                      onChange={(e) => setRefDetails({ ...refDetails, sourceUrl: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Citation / Attribution *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Authors, publication year, paper title"
                      value={refDetails.citation}
                      onChange={(e) => setRefDetails({ ...refDetails, citation: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">License / Terms *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. CC-BY-4.0 / Public Domain"
                        value={refDetails.license}
                        onChange={(e) => setRefDetails({ ...refDetails, license: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Machine / Component Type</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. High-Speed Pinion Rig"
                        value={refDetails.machineType}
                        onChange={(e) => setRefDetails({ ...refDetails, machineType: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Operating Conditions & Load</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. 1800 RPM, 0-3 HP load range"
                      value={refDetails.operatingConditions}
                      onChange={(e) => setRefDetails({ ...refDetails, operatingConditions: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Known Limitations & Constraints</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Stationary load only; no run-to-failure degradation"
                      value={refDetails.knownLimitations}
                      onChange={(e) => setRefDetails({ ...refDetails, knownLimitations: e.target.value })}
                    />
                  </div>
                  <label className="checkbox-row" style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={refDetails.userConfirmedTerms}
                      onChange={(e) => setRefDetails({ ...refDetails, userConfirmedTerms: e.target.checked })}
                    />
                    <span className="text-sm">
                      I confirm that I downloaded this dataset from its official source and that its terms permit research benchmarking.
                    </span>
                  </label>
                </div>
              )}

              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label className="form-label">Dataset Title *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Extruder Gearbox High-Load Vibration Run"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Operational Notes / Description</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Optional context: operating RPM, motor load, ambient temperature..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </Card>

            {/* Stage 2: Select File & Upload */}
            <Card
              title="2. Select & Upload CSV File"
              subtitle="Files are processed locally and sanitized; server never fetches arbitrary URLs"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />

              <div
                className={`upload-dropzone ${isDragOver ? 'dropzone-active' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  handleFileSelect(e.dataTransfer.files?.[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{ cursor: 'pointer' }}
              >
                <div className="dropzone-icon" aria-hidden="true">
                  <Icon name="upload" size={36} color="#7c3aed" />
                </div>
                <div className="dropzone-title">
                  {selectedFile ? selectedFile.name : 'Click or drag & drop CSV file here'}
                </div>
                <div className="dropzone-subtitle">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready to upload`
                    : 'Supports CSV (.csv, .txt) with header row • Max 25 MB'}
                </div>
                <div className="dropzone-meta">
                  Delimiters accepted: comma (,), semicolon (;), tab
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="dropzone-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  {selectedFile ? 'Change File' : 'Browse Local Files'}
                </Button>
              </div>

              {uploadError && (
                <div style={{ marginTop: '0.75rem' }}>
                  <AlertCallout severity="critical" title="Upload Failed" description={uploadError} />
                </div>
              )}

              {selectedFile && !uploadedSession && (
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="primary"
                    disabled={uploading}
                    onClick={handleUpload}
                  >
                    {uploading ? `Uploading (${uploadProgress}%)...` : 'Upload & Parse Headers'}
                  </Button>
                </div>
              )}

              {uploadedSession && (
                <div className="upload-success-panel" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-surface-subtle)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="table-primary-text" style={{ fontWeight: 600 }}>File Uploaded & Parsed</span>
                    <StatusBadge status="healthy" label="UPLOADED" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                    <div><span className="text-muted">Detected Rows:</span> <strong>{uploadedSession.totalRows}</strong></div>
                    <div><span className="text-muted">Columns:</span> <strong>{uploadedSession.totalColumns}</strong></div>
                    <div><span className="text-muted">Delimiter:</span> <code>&apos;{uploadedSession.delimiter}&apos;</code></div>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Stage 3: Column Mapping & Preview */}
          {uploadedSession && (
            <Card
              title="3. Map Sensor Signals & Physical Units"
              subtitle="Map detected CSV columns to normalized gearbox physical channels"
              badge={<StatusBadge status="info" label={`${uploadedSession.headers.length} Columns Detected`} />}
            >
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">CSV Column Header</th>
                      <th scope="col">Signal Type / Role</th>
                      <th scope="col">Physical Unit</th>
                      <th scope="col">Preview Sample (Row 1)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columnMappings.map((col) => {
                      let currentRole = 'unmapped';
                      if (col.isTimestamp) currentRole = 'timestamp';
                      else if (col.isLabel) currentRole = 'label';
                      else if (col.mappedSignal) currentRole = col.mappedSignal;

                      const sampleVal = uploadedSession.previewRows?.[0]?.[col.rawHeader] ?? '—';

                      return (
                        <tr key={col.rawHeader}>
                          <td>
                            <span className="mono-code" style={{ fontWeight: 600 }}>{col.rawHeader}</span>
                          </td>
                          <td>
                            <select
                              className="form-select"
                              value={currentRole}
                              onChange={(e) => updateMapping(col.rawHeader, 'role', e.target.value)}
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                            >
                              <option value="timestamp">Timestamp / Datetime</option>
                              <optgroup label="Gearbox Monitored Signals">
                                {Object.values(GEARBOX_SIGNALS).map((sig) => (
                                  <option key={sig.key} value={sig.key}>
                                    {sig.label} ({sig.category})
                                  </option>
                                ))}
                              </optgroup>
                              <option value="label">Ground-Truth Fault Label</option>
                              <option value="unmapped">— Ignore / Unmapped Column —</option>
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-input"
                              style={{ width: '110px', padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                              value={col.sourceUnit}
                              placeholder="unit"
                              onChange={(e) => updateMapping(col.rawHeader, 'sourceUnit', e.target.value)}
                            />
                          </td>
                          <td>
                            <span className="mono-code text-muted">{String(sampleVal)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <Button
                  variant="primary"
                  disabled={validating}
                  onClick={handleValidate}
                >
                  {validating ? 'Running Quality Validation...' : 'Run Quality Checks & Assess AI Compatibility'}
                </Button>
              </div>

              {validationError && (
                <div style={{ marginTop: '0.75rem' }}>
                  <AlertCallout severity="critical" title="Validation Failed" description={validationError} />
                </div>
              )}
            </Card>
          )}

          {/* Stage 4: Validation Findings & AI Compatibility Review */}
          {validationResult && (
            <Card
              title="4. Data Quality Findings & AI Task Compatibility Assessment"
              subtitle="Comprehensive engineering evaluation before persisting dataset into factory records"
              badge={
                <StatusBadge
                  status={
                    validationResult.status === DATASET_STATUS.READY
                      ? 'healthy'
                      : validationResult.status === DATASET_STATUS.NEEDS_REVIEW
                      ? 'warning'
                      : 'critical'
                  }
                  label={validationResult.status.toUpperCase()}
                />
              }
            >
              {/* Quality Findings Callouts */}
              <div style={{ marginBottom: '1.25rem' }}>
                {validationResult.qualityFindings.length === 0 ? (
                  <AlertCallout
                    severity="healthy"
                    title="All Data Quality Checks Passed"
                    description="No monotonic order violations, missing values, or physical out-of-bounds readings detected."
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {validationResult.qualityFindings.map((f, i) => (
                      <div
                        key={i}
                        className={`quality-finding-pill severity-${f.severity}`}
                        style={{
                          padding: '0.65rem 1rem',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          background:
                            f.severity === 'error'
                              ? 'var(--status-critical-bg)'
                              : f.severity === 'warning'
                              ? 'var(--status-warning-bg)'
                              : 'var(--status-info-bg)',
                          border: `1px solid ${
                            f.severity === 'error'
                              ? 'var(--status-critical-border)'
                              : f.severity === 'warning'
                              ? 'var(--status-warning-border)'
                              : 'var(--status-info-border)'
                          }`
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase' }}>
                          [{f.severity}]
                        </span>
                        <span style={{ flex: 1, fontSize: '0.875rem' }}>{f.message}</span>
                        {f.affectedCount > 0 && (
                          <span className="mono-code text-muted" style={{ fontSize: '0.8rem' }}>
                            {f.affectedCount} affected rows
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Physical Profile Summary */}
              <div className="metrics-grid" style={{ marginBottom: '1.25rem' }}>
                <div className="metric-box">
                  <span className="metric-box-label">Dataset Modality</span>
                  <span className="metric-box-val" style={{ fontSize: '1.1rem' }}>{validationResult.modality}</span>
                  <span className="metric-box-sub">Identified automatically</span>
                </div>
                <div className="metric-box">
                  <span className="metric-box-label">Estimated Sampling Rate</span>
                  <span className="metric-box-val">
                    {validationResult.samplingRateHz ? `${validationResult.samplingRateHz} Hz` : 'N/A'}
                  </span>
                  <span className="metric-box-sub">
                    {validationResult.samplingIntervalMeanMs
                      ? `~${Math.round(validationResult.samplingIntervalMeanMs)} ms interval`
                      : 'Irregular or static'}
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-box-label">Time Coverage</span>
                  <span className="metric-box-val">
                    {validationResult.timeRange?.durationSeconds
                      ? `${Math.round(validationResult.timeRange.durationSeconds / 60)} min`
                      : 'Snapshot'}
                  </span>
                  <span className="metric-box-sub">
                    {validationResult.timeRange?.start
                      ? new Date(validationResult.timeRange.start).toLocaleDateString()
                      : 'Unspecified'}
                  </span>
                </div>
              </div>

              {/* AI Task Compatibility Cards */}
              <div style={{ marginTop: '1rem' }}>
                <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
                  Future AI Model Task Compatibility Assessment
                </h3>
                <div className="grid-two-col" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  {/* 1. Anomaly Detection */}
                  <div
                    className="task-compat-card"
                    style={{
                      background: 'var(--bg-surface-elevated)',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 600 }}>Anomaly Detection</span>
                        <StatusBadge
                          status={validationResult.aiTaskCompatibility[AI_TASK_TYPES.ANOMALY_DETECTION].isCompatible ? 'healthy' : 'critical'}
                          label={validationResult.aiTaskCompatibility[AI_TASK_TYPES.ANOMALY_DETECTION].isCompatible ? 'COMPATIBLE' : 'INCOMPATIBLE'}
                        />
                      </div>
                      <p className="text-secondary text-sm" style={{ marginBottom: '0.5rem' }}>
                        {validationResult.aiTaskCompatibility[AI_TASK_TYPES.ANOMALY_DETECTION].reason}
                      </p>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                      Recommended: {validationResult.aiTaskCompatibility[AI_TASK_TYPES.ANOMALY_DETECTION].recommendedModel}
                    </div>
                  </div>

                  {/* 2. Fault Classification */}
                  <div
                    className="task-compat-card"
                    style={{
                      background: 'var(--bg-surface-elevated)',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 600 }}>Fault Classification</span>
                        <StatusBadge
                          status={validationResult.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION].isCompatible ? 'healthy' : 'critical'}
                          label={validationResult.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION].isCompatible ? 'COMPATIBLE' : 'INCOMPATIBLE'}
                        />
                      </div>
                      <p className="text-secondary text-sm" style={{ marginBottom: '0.5rem' }}>
                        {validationResult.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION].reason}
                      </p>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                      Recommended: {validationResult.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION].recommendedModel}
                    </div>
                  </div>

                  {/* 3. Remaining Useful Life (RUL) */}
                  <div
                    className="task-compat-card"
                    style={{
                      background: 'var(--bg-surface-elevated)',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 600 }}>Remaining Useful Life (RUL)</span>
                        <StatusBadge
                          status={validationResult.aiTaskCompatibility[AI_TASK_TYPES.REMAINING_USEFUL_LIFE].isCompatible ? 'healthy' : 'critical'}
                          label={validationResult.aiTaskCompatibility[AI_TASK_TYPES.REMAINING_USEFUL_LIFE].isCompatible ? 'COMPATIBLE' : 'INCOMPATIBLE'}
                        />
                      </div>
                      <p className="text-secondary text-sm" style={{ marginBottom: '0.5rem' }}>
                        {validationResult.aiTaskCompatibility[AI_TASK_TYPES.REMAINING_USEFUL_LIFE].reason}
                      </p>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                      Recommended: {validationResult.aiTaskCompatibility[AI_TASK_TYPES.REMAINING_USEFUL_LIFE].recommendedModel}
                    </div>
                  </div>
                </div>
              </div>

              {/* Confirm Ingestion Button */}
              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Discard
                </Button>
                <Button
                  variant="primary"
                  disabled={confirming || validationResult.status === DATASET_STATUS.REJECTED}
                  onClick={handleConfirmIngestion}
                >
                  {confirming ? 'Ingesting Dataset...' : 'Confirm Dataset Ingestion'}
                </Button>
              </div>
            </Card>
          )}

          {/* Recently Ingested Datasets Ledger */}
          <Card
            title="Registered Factory Datasets"
            subtitle="Historical operational and reference datasets available for this facility"
            badge={<span className="badge badge-demo">INGESTION LEDGER</span>}
          >
            {loadingRecent ? (
              <p className="text-muted text-sm">Loading registered datasets...</p>
            ) : recentDatasets.length === 0 ? (
              <p className="text-muted text-sm">No datasets currently registered.</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Title & Provenance</th>
                      <th scope="col">Category</th>
                      <th scope="col">Target Machine</th>
                      <th scope="col">Modality</th>
                      <th scope="col">Rows</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDatasets.map((d) => (
                      <tr key={d._id}>
                        <td>
                          <div className="table-primary-text" style={{ fontWeight: 600 }}>
                            {d.title}
                            {(d.isSimulatorDerived || d.isDemoData || d.title?.includes('[Demo Data]')) && (
                              <span className="badge badge-demo" style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px' }}>Demo Data</span>
                            )}
                            {d.isSimulatorDerived && (
                              <span className="badge badge-info" style={{ marginLeft: 4, fontSize: 10, padding: '1px 5px' }}>Simulator Test</span>
                            )}
                          </div>
                          <span className="mono-code text-muted" style={{ fontSize: '0.75rem' }}>
                            Uploaded by {d.uploadedByName} • {new Date(d.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${d.datasetType === DATASET_TYPES.REFERENCE ? 'badge-demo' : 'badge-site'}`}>
                            {d.datasetType.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {d.machineId ? (
                            <span className="mono-code">{d.machineId.code || d.machineId}</span>
                          ) : (
                            <span className="text-muted">Research Specimen</span>
                          )}
                        </td>
                        <td>
                          <span className="text-sm">{d.modality}</span>
                        </td>
                        <td>
                          <span className="mono-code">{d.totalRows?.toLocaleString()}</span>
                        </td>
                        <td>
                          <StatusBadge
                            status={d.status === 'ready' ? 'healthy' : d.status === 'needs_review' ? 'warning' : 'critical'}
                            label={d.status.toUpperCase()}
                          />
                        </td>
                        <td>
                          <a
                            href={`${API_BASE}/datasets/${d._id}/download`}
                            download
                            className="btn btn-secondary btn-sm"
                            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <Icon name="download" size={13} />
                            <span>Download CSV</span>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
