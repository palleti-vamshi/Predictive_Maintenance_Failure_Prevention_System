import React, { useState, useEffect, useRef } from 'react';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter, ROUTES } from '../router/Router.jsx';
import {
  GEARBOX_SIGNALS,
  DATASET_TYPES,
  DATASET_STATUS,
  MODEL_TYPES,
  AI_TASK_TYPES,
  USER_ROLES,
  MAX_OPERATIONAL_UPLOAD_SIZE_BYTES,
  MAX_RESEARCH_UPLOAD_SIZE_BYTES,
  DEFAULT_CHUNK_SIZE_BYTES,
  ACCEPTED_RESEARCH_EXTENSIONS,
  DATASET_JOB_STATUS,
  DATASET_JOB_STAGES
} from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const jobStagesList = [
  { key: 'validating_integrity', label: '1. SHA-256 Checksum' },
  { key: 'inspecting_archive', label: '2. Safe Archive Check' },
  { key: 'stream_profiling', label: '3. Streaming Profiler' },
  { key: 'evaluating_compatibility', label: '4. AI Compatibility' },
  { key: 'complete', label: '5. Ingest Complete' }
];

function getStageStep(stage) {
  if (!stage) return 0;
  if (stage === 'validating_integrity') return 0;
  if (stage === 'inspecting_archive' || stage === 'extracting_archive') return 1;
  if (stage === 'stream_profiling') return 2;
  if (stage === 'evaluating_compatibility') return 3;
  if (stage === 'complete') return 4;
  return 0;
}

export default function DatasetUploadPage() {
  const { user } = useAuth();
  const { navigate, queryParams } = useRouter();

  // Wizard state
  const [datasetType, setDatasetType] = useState(DATASET_TYPES.OPERATIONAL);
  const [isSimulatorDerived, setIsSimulatorDerived] = useState(false);
  const [machines, setMachines] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Storage Quota state
  const [storageQuota, setStorageQuota] = useState(null);

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
  const [uploadPaused, setUploadPaused] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState('');
  const [uploadEta, setUploadEta] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploadedSession, setUploadedSession] = useState(null);
  const [activeUploadId, setActiveUploadId] = useState(null);

  // Background Processing Job state
  const [activeJob, setActiveJob] = useState(null);
  const jobPollingTimerRef = useRef(null);

  // Refs for upload lifecycle & async control
  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const activeUploadIdRef = useRef(null);
  const fileInputRef = useRef(null);

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

  // Models and In-Place Compatible Analysis state
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [completedRun, setCompletedRun] = useState(null);

  // Fetch accessible machines, storage quota, recent datasets, and available models
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
          if (mData.machines?.length > 0) {
            const target = queryParams?.machineId && mData.machines.find((m) => m._id === queryParams.machineId || m.code === queryParams.machineId);
            setSelectedMachineId(target ? target._id : (selectedMachineId || mData.machines[0]._id));
          }
        }

        // Fetch versioned ML models for compatible analysis
        const modRes = await fetch(`${API_BASE}/models`, { credentials: 'include', headers });
        if (modRes.ok) {
          const modData = await modRes.json();
          setAvailableModels(modData.models || []);
        }

        // Fetch storage quota
        loadQuota();

        // Fetch recent datasets
        loadRecentDatasets();
      } catch (err) {
        console.error('Failed to load initial upload data:', err);
      }
    }
    loadInitialData();

    return () => {
      if (jobPollingTimerRef.current) {
        clearInterval(jobPollingTimerRef.current);
        jobPollingTimerRef.current = null;
      }
    };
  }, [user]);

  // Load target dataset if datasetId is passed in queryParams
  useEffect(() => {
    if (!queryParams?.datasetId) return;

    async function loadTargetDataset() {
      try {
        const token = user?.sessionToken || localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const dsRes = await fetch(`${API_BASE}/datasets/${queryParams.datasetId}`, { credentials: 'include', headers });
        if (dsRes.ok) {
          const dsData = await dsRes.json();
          if (dsData.dataset) {
            setConfirmedDataset(dsData.dataset);
          }
        }
      } catch (err) {
        console.warn('Could not load confirmed dataset from query params:', err);
      }
    }

    loadTargetDataset();
  }, [queryParams?.datasetId, user]);

  // Auto-select compatible model when a dataset is confirmed
  useEffect(() => {
    if (!confirmedDataset || availableModels.length === 0) return;

    const readyModels = availableModels.filter((m) => m.status === 'ready');
    const hasLabels = Boolean(
      (confirmedDataset.labelDistribution && (
        confirmedDataset.labelDistribution instanceof Map
          ? confirmedDataset.labelDistribution.size > 0
          : Object.keys(confirmedDataset.labelDistribution).length > 0
      )) ||
      confirmedDataset.columns?.some((c) => c.isLabel || /^(label|fault_class|defect|class)$/i.test(c.rawHeader || c.name || ''))
    );

    const datasetComponent = (
      confirmedDataset.referenceDetails?.machineType ||
      confirmedDataset.componentType ||
      (confirmedDataset.title?.toLowerCase().includes('bearing') ? 'bearing' : 'gearbox')
    ).toLowerCase();
    const isGearbox = datasetComponent.includes('gear');

    const rfModel = readyModels.find((m) =>
      m.modelType === MODEL_TYPES.RANDOM_FOREST &&
      (isGearbox ? (m.componentType === 'gearbox' || m.targetDomain === 'gear_faults') : m.componentType === 'bearing')
    ) || readyModels.find((m) => m.modelType === MODEL_TYPES.RANDOM_FOREST);

    const ifModel = readyModels.find((m) =>
      m.modelType === MODEL_TYPES.ISOLATION_FOREST &&
      (isGearbox ? (m.componentType === 'gearbox' || m.targetDomain !== 'bearing_faults') : m.componentType === 'bearing')
    ) || readyModels.find((m) => m.modelType === MODEL_TYPES.ISOLATION_FOREST);

    if (hasLabels && rfModel) {
      setSelectedModelId(rfModel._id);
    } else if (ifModel) {
      setSelectedModelId(ifModel._id);
    } else if (readyModels.length > 0) {
      setSelectedModelId(readyModels[0]._id);
    }
  }, [confirmedDataset, availableModels]);

  // In-place execution of compatible model analysis
  async function handleRunCompatibleAnalysis(targetModelId) {
    const modelId = targetModelId || selectedModelId;
    if (!modelId || !confirmedDataset) return;

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const machineId = confirmedDataset.machineId?._id || confirmedDataset.machineId || selectedMachineId;
      const winSize = (confirmedDataset.totalRows && confirmedDataset.totalRows < 256) ? 64 : 128;

      const res = await fetch(`${API_BASE}/analysis-runs`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          machineId,
          datasetId: confirmedDataset._id,
          modelArtifactId: modelId,
          configuration: {
            windowSize: winSize,
            overlapRatio: 0.5
          },
          sync: true
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Analysis run failed to execute.');
      }

      setCompletedRun(data.analysisRun);
      loadRecentDatasets();
    } catch (err) {
      console.error('Model analysis failed:', err);
      setAnalysisError(err.message || 'Failed to execute model analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function loadQuota() {
    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/datasets/storage/quota`, { credentials: 'include', headers });
      if (res.ok) {
        const data = await res.json();
        setStorageQuota(data);
      }
    } catch (e) {
      console.warn('Could not load storage quota:', e);
    }
  }

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

  // Handle file drop / select with role, size, and quota validation
  function handleFileSelect(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const isReference = datasetType === DATASET_TYPES.REFERENCE;
    const allowedExts = isReference ? ACCEPTED_RESEARCH_EXTENSIONS : ['.csv', '.txt'];
    const hasAllowedExt = allowedExts.some((ext) => name.endsWith(ext));

    if (!hasAllowedExt) {
      setUploadError(
        `Invalid file format for ${isReference ? 'Research' : 'Operational'} upload. Supported formats: ${allowedExts.join(', ')}.`
      );
      return;
    }

    const maxSizeBytes = isReference
      ? (storageQuota?.maxResearchUploadSizeBytes || MAX_RESEARCH_UPLOAD_SIZE_BYTES)
      : (storageQuota?.maxOperationalUploadSizeBytes || MAX_OPERATIONAL_UPLOAD_SIZE_BYTES);
    const maxMb = Math.round(maxSizeBytes / (1024 * 1024));

    if (file.size > maxSizeBytes) {
      setUploadError(`File exceeds the ${maxMb >= 1024 ? `${(maxMb / 1024).toFixed(0)} GB` : `${maxMb} MB`} size limit.`);
      return;
    }

    if (storageQuota?.remainingQuotaBytes && file.size > storageQuota.remainingQuotaBytes) {
      const remMb = Math.round(storageQuota.remainingQuotaBytes / (1024 * 1024));
      setUploadError(`File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds remaining factory research storage quota (${remMb} MB).`);
      return;
    }

    setUploadError(null);
    setSelectedFile(file);
    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
    }
  }

  // Pause chunked upload
  function handlePauseUpload() {
    isPausedRef.current = true;
    setUploadPaused(true);
  }

  // Resume chunked upload
  function handleResumeUpload() {
    isPausedRef.current = false;
    setUploadPaused(false);
  }

  // Cancel chunked upload & clean up server-side staging
  async function handleCancelUpload() {
    isCancelledRef.current = true;
    setUploadPaused(false);
    setUploading(false);

    const upId = activeUploadIdRef.current;
    if (upId) {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await fetch(`${API_BASE}/datasets/uploads/${upId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers
      }).catch(() => {});
    }

    setUploadProgress(0);
    setUploadedBytes(0);
    setUploadSpeed('');
    setUploadEta(null);
    setActiveUploadId(null);
    activeUploadIdRef.current = null;
    setSelectedFile(null);
  }

  // Cancel active background processing job
  async function handleCancelJob() {
    if (!activeJob?.jobId) return;
    const token = user?.sessionToken || localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      await fetch(`${API_BASE}/datasets/jobs/${activeJob.jobId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers
      });

      setActiveJob((prev) => ({
        ...prev,
        status: 'cancelled',
        stage: 'cancelled',
        stageMessage: 'Processing job cancelled by user.'
      }));

      if (jobPollingTimerRef.current) {
        clearInterval(jobPollingTimerRef.current);
        jobPollingTimerRef.current = null;
      }
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  }

  // Execute Resumable Chunked Upload & Trigger Asynchronous Stream Profiler
  async function handleChunkedUpload() {
    if (!selectedFile) return;

    setUploading(true);
    setUploadPaused(false);
    setUploadProgress(0);
    setUploadedBytes(0);
    setUploadSpeed('');
    setUploadEta(null);
    setUploadError(null);
    setActiveJob(null);
    isPausedRef.current = false;
    isCancelledRef.current = false;

    const token = user?.sessionToken || localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const chunkSize = DEFAULT_CHUNK_SIZE_BYTES; // 5 MB
    const totalChunks = Math.max(1, Math.ceil(selectedFile.size / chunkSize));

    const isSim = Boolean(isSimulatorDerived || datasetType === 'simulator');
    const finalTitle = isSim && !title.trim().includes('[SIMULATED]')
      ? `[SIMULATED] ${title.trim()}`
      : (title.trim() || selectedFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));

    try {
      // 1. Initiate upload session
      const initRes = await fetch(`${API_BASE}/datasets/uploads/initiate`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify({
          originalFilename: selectedFile.name,
          fileSizeBytes: selectedFile.size,
          mimeType: selectedFile.type || 'text/csv',
          totalChunks,
          chunkSizeBytes: chunkSize,
          datasetType: datasetType === 'simulator' ? DATASET_TYPES.OPERATIONAL : datasetType,
          machineId: (datasetType === DATASET_TYPES.OPERATIONAL || datasetType === 'simulator') ? selectedMachineId : null,
          title: finalTitle,
          description: description.trim(),
          referenceDetails: datasetType === DATASET_TYPES.REFERENCE ? refDetails : undefined,
          isSimulatorDerived: isSim,
          isDemoData: isSim
        })
      });

      const initData = await initRes.json();
      if (!initRes.ok) {
        throw new Error(initData.message || 'Failed to initiate upload session.');
      }

      const { uploadId } = initData;
      setActiveUploadId(uploadId);
      activeUploadIdRef.current = uploadId;

      let receivedSet = new Set(initData.receivedChunks || []);
      let transferredBytes = Array.from(receivedSet).length * chunkSize;
      setUploadedBytes(transferredBytes);
      setUploadProgress(Math.round((transferredBytes / selectedFile.size) * 100));

      const startTime = Date.now();

      // 2. Upload chunks sequentially
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Handle Cancel
        if (isCancelledRef.current) {
          await fetch(`${API_BASE}/datasets/uploads/${uploadId}/cancel`, {
            method: 'POST',
            credentials: 'include',
            headers
          }).catch(() => {});
          setUploading(false);
          setUploadProgress(0);
          return;
        }

        // Handle Pause: loop while paused
        while (isPausedRef.current) {
          await new Promise((r) => setTimeout(r, 250));
          if (isCancelledRef.current) {
            await fetch(`${API_BASE}/datasets/uploads/${uploadId}/cancel`, {
              method: 'POST',
              credentials: 'include',
              headers
            }).catch(() => {});
            setUploading(false);
            setUploadProgress(0);
            return;
          }
        }

        // If chunk was already received (e.g. session resume), skip
        if (receivedSet.has(chunkIndex)) {
          continue;
        }

        const start = chunkIndex * chunkSize;
        const end = Math.min(selectedFile.size, start + chunkSize);
        const chunkBlob = selectedFile.slice(start, end);

        // Upload single chunk with up to 3 automatic retries
        let chunkSuccess = false;
        let lastErr = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          if (isCancelledRef.current) break;

          try {
            const chunkRes = await fetch(`${API_BASE}/datasets/uploads/${uploadId}/chunk?chunkIndex=${chunkIndex}`, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-Chunk-Index': String(chunkIndex),
                'X-Chunk-Size': String(chunkBlob.size),
                ...headers
              },
              body: chunkBlob
            });

            if (chunkRes.ok) {
              chunkSuccess = true;
              break;
            } else {
              const errData = await chunkRes.json().catch(() => ({}));
              lastErr = new Error(errData.message || `Chunk ${chunkIndex + 1} upload returned status ${chunkRes.status}`);
            }
          } catch (err) {
            lastErr = err;
          }

          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 500));
          }
        }

        if (!chunkSuccess) {
          throw lastErr || new Error(`Failed to upload chunk ${chunkIndex + 1} after 3 attempts.`);
        }

        receivedSet.add(chunkIndex);
        transferredBytes = Math.min(selectedFile.size, transferredBytes + chunkBlob.size);
        const pct = Math.min(100, Math.round((transferredBytes / selectedFile.size) * 100));

        setUploadedBytes(transferredBytes);
        setUploadProgress(pct);

        // Calculate upload speed & ETA
        const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
        const bytesPerSec = transferredBytes / elapsedSec;
        const speedMb = (bytesPerSec / (1024 * 1024)).toFixed(1);
        setUploadSpeed(`${speedMb} MB/s`);

        const remainingBytes = Math.max(0, selectedFile.size - transferredBytes);
        const remainingSec = Math.round(remainingBytes / bytesPerSec);
        setUploadEta(remainingSec);
      }

      // 3. Complete chunked upload & trigger background stream processing job
      const completeRes = await fetch(`${API_BASE}/datasets/uploads/${uploadId}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify({ columnMappings: [] })
      });

      const completeData = await completeRes.json();
      if (!completeRes.ok) {
        throw new Error(completeData.message || 'Failed to assemble and verify upload.');
      }

      setUploadProgress(100);
      setUploading(false);

      // 4. Start polling background job
      if (completeData.jobId) {
        startPollingJob(completeData.jobId, completeData.datasetId);
      }
    } catch (err) {
      console.error('Chunked upload failed:', err);
      setUploadError(err.message || 'Chunked file upload failed.');
      setUploading(false);
    }
  }

  // Poll asynchronous dataset ingestion & stream profiling job
  function startPollingJob(jobId, datasetId) {
    if (jobPollingTimerRef.current) {
      clearInterval(jobPollingTimerRef.current);
    }

    setActiveJob({
      jobId,
      datasetId,
      status: 'queued',
      stage: 'queued',
      progress: 5,
      stageMessage: 'Dataset queued for cryptographic verification and stream profiling...'
    });

    const token = user?.sessionToken || localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    jobPollingTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/datasets/jobs/${jobId}`, {
          credentials: 'include',
          headers
        });

        if (!res.ok) return;

        const job = await res.json();
        setActiveJob(job);

        if (job.status === 'complete') {
          clearInterval(jobPollingTimerRef.current);
          jobPollingTimerRef.current = null;

          // Load completed dataset
          const dRes = await fetch(`${API_BASE}/datasets/${datasetId}`, {
            credentials: 'include',
            headers
          });

          if (dRes.ok) {
            const dData = await dRes.json();
            const completedDataset = dData.dataset;
            setConfirmedDataset(completedDataset);

            // Populate mapping and validation preview for review
            setUploadedSession({
              uploadId: completedDataset._id,
              headers: (completedDataset.columns || []).map((c) => c.rawHeader),
              totalRows: completedDataset.totalRows,
              totalColumns: completedDataset.totalColumns,
              delimiter: completedDataset.delimiter,
              previewRows: completedDataset.previewRows || []
            });

            setValidationResult({
              status: completedDataset.status || DATASET_STATUS.READY,
              qualityFindings: completedDataset.qualityFindings || [],
              modality: completedDataset.modality,
              samplingRateHz: completedDataset.samplingRateHz,
              samplingIntervalMeanMs: completedDataset.samplingIntervalMeanMs,
              timeRange: completedDataset.timeRange,
              aiTaskCompatibility: completedDataset.aiTaskCompatibility || {}
            });

            loadRecentDatasets();
            loadQuota();
          }
        } else if (job.status === 'failed') {
          clearInterval(jobPollingTimerRef.current);
          jobPollingTimerRef.current = null;
          setUploadError(job.errorMessage || 'Dataset processing failed.');
        } else if (job.status === 'cancelled') {
          clearInterval(jobPollingTimerRef.current);
          jobPollingTimerRef.current = null;
        }
      } catch (err) {
        console.error('Error polling dataset job:', err);
      }
    }, 800);
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

      const isSim = Boolean(isSimulatorDerived || datasetType === 'simulator');
      const finalTitle = isSim && !title.trim().includes('[SIMULATED]')
        ? `[SIMULATED] ${title.trim()}`
        : title.trim();

      const payload = {
        uploadId: uploadedSession.uploadId,
        datasetType: datasetType === 'simulator' ? DATASET_TYPES.OPERATIONAL : datasetType,
        title: finalTitle,
        description: description.trim(),
        machineId: (datasetType === DATASET_TYPES.OPERATIONAL || datasetType === 'simulator') ? selectedMachineId : null,
        columnMappings,
        referenceDetails: datasetType === DATASET_TYPES.REFERENCE ? refDetails : undefined,
        isSimulatorDerived: isSim,
        isDemoData: isSim
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
    if (jobPollingTimerRef.current) {
      clearInterval(jobPollingTimerRef.current);
      jobPollingTimerRef.current = null;
    }
    setSelectedFile(null);
    setUploadedSession(null);
    setColumnMappings([]);
    setValidationResult(null);
    setConfirmedDataset(null);
    setTitle('');
    setDescription('');
    setUploading(false);
    setUploadPaused(false);
    setUploadProgress(0);
    setUploadedBytes(0);
    setUploadSpeed('');
    setUploadEta(null);
    setActiveUploadId(null);
    setActiveJob(null);
    setCompletedRun(null);
    setIsAnalyzing(false);
    setAnalysisError(null);
    isPausedRef.current = false;
    isCancelledRef.current = false;
    activeUploadIdRef.current = null;
    loadQuota();
  }

  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-demo">DEMO DATA</span>
            <span className="badge badge-operational">DATASET INGESTION</span>
          </div>
          <h1 className="page-title">Datasets</h1>
          <p className="page-subtitle">
            Upload CSV exports for a registered machine, map them to its signals, and check them before analysis.
          </p>
        </div>
        {confirmedDataset && (
          <Button variant="secondary" onClick={handleReset} icon="upload">
            New upload
          </Button>
        )}
      </div>

      {/* Step Wizard Progress Bar (UX Pilot Page 8) */}
      <nav className="upload-steps-nav upload-reveal-section upload-stagger-1" aria-label="Dataset Ingestion Steps">
        <div className={`upload-step-item ${!selectedFile ? 'active' : 'completed'}`}>
          <span className="upload-step-num">1</span>
          <span>Machine Specimen</span>
        </div>
        <span className="upload-step-arrow" aria-hidden="true">→</span>
        <div className={`upload-step-item ${selectedFile && !uploadedSession ? 'active' : uploadedSession ? 'completed' : ''}`}>
          <span className="upload-step-num">2</span>
          <span>Select CSV</span>
        </div>
        <span className="upload-step-arrow" aria-hidden="true">→</span>
        <div className={`upload-step-item ${uploadedSession && !validationResult ? 'active' : validationResult ? 'completed' : ''}`}>
          <span className="upload-step-num">3</span>
          <span>Map Signals</span>
        </div>
        <span className="upload-step-arrow" aria-hidden="true">→</span>
        <div className={`upload-step-item ${validationResult && !confirmedDataset ? 'active' : confirmedDataset ? 'completed' : ''}`}>
          <span className="upload-step-num">4</span>
          <span>Engineering Checks</span>
        </div>
        <span className="upload-step-arrow" aria-hidden="true">→</span>
        <div className={`upload-step-item ${confirmedDataset ? 'active' : ''}`}>
          <span className="upload-step-num">5</span>
          <span>Run Analysis</span>
        </div>
      </nav>

      {confirmedDataset ? (
        /* Ingestion Success View */
        <Card
          title="Dataset Ingestion Confirmed"
          subtitle="File validated and registered in persistent factory records"
          badge={<StatusBadge status="healthy" label="READY" />}
          className="upload-reveal-section upload-stagger-2"
        >
          <AlertCallout
            severity="healthy"
            title={`Successfully Ingested: ${confirmedDataset.title}`}
            description={`Dataset registered with ${confirmedDataset.totalRows?.toLocaleString() || 0} rows across ${confirmedDataset.columns?.length || 0} mapped channels. Modality classified as "${confirmedDataset.modality}".`}
          />

          <div className="metrics-grid" style={{ marginTop: '1.25rem' }}>
            <div className="metric-box">
              <span className="metric-box-label">Modality Classification</span>
              <span className="metric-box-val" style={{ fontSize: '1.1rem' }}>{confirmedDataset.modality}</span>
              <span className="metric-box-sub">Schema v{confirmedDataset.dataSchemaVersion || 1}</span>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Observations</span>
              <span className="metric-box-val">{confirmedDataset.totalRows?.toLocaleString() || 0}</span>
              <span className="metric-box-sub">Delimiter: &apos;{confirmedDataset.delimiter || ','}&apos;</span>
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

          {/* Model Compatibility & In-Place Execution Selector */}
          {(() => {
            const readyModels = availableModels.filter((m) => m.status === 'ready');
            const hasLabels = Boolean(
              (confirmedDataset.labelDistribution && (
                confirmedDataset.labelDistribution instanceof Map
                  ? confirmedDataset.labelDistribution.size > 0
                  : Object.keys(confirmedDataset.labelDistribution).length > 0
              )) ||
              confirmedDataset.columns?.some((c) => c.isLabel || /^(label|fault_class|defect|class)$/i.test(c.rawHeader || c.name || ''))
            );

            const datasetComponent = (
              confirmedDataset.referenceDetails?.machineType ||
              confirmedDataset.componentType ||
              (confirmedDataset.title?.toLowerCase().includes('bearing') ? 'bearing' : 'gearbox')
            ).toLowerCase();
            const isGearbox = datasetComponent.includes('gear');

            const rfModel = readyModels.find((m) =>
              m.modelType === MODEL_TYPES.RANDOM_FOREST &&
              (isGearbox ? (m.componentType === 'gearbox' || m.targetDomain === 'gear_faults') : m.componentType === 'bearing')
            ) || readyModels.find((m) => m.modelType === MODEL_TYPES.RANDOM_FOREST);

            const ifModel = readyModels.find((m) =>
              m.modelType === MODEL_TYPES.ISOLATION_FOREST &&
              (isGearbox ? (m.componentType === 'gearbox' || m.targetDomain !== 'bearing_faults') : m.componentType === 'bearing')
            ) || readyModels.find((m) => m.modelType === MODEL_TYPES.ISOLATION_FOREST);

            return (
              <div className="model-compat-section">
                <div className="model-compat-section-title">
                  <Icon name="activity" size={16} color="var(--primary)" />
                  Compatible AI/ML Models for Ingested Telemetry
                </div>
                <p className="model-compat-section-desc">
                  Select a certified model calibrated for this gearbox component. Models with incompatible schemas, missing label columns, or disparate time regimes are strictly disqualified.
                </p>

                <div className="model-compat-grid">
                  {/* Model 1: Random Forest Fault Classifier */}
                  <div
                    className={`model-compat-card ${selectedModelId === rfModel?._id ? 'selected' : ''} ${!hasLabels ? 'incompatible' : ''}`}
                    onClick={() => {
                      if (hasLabels && rfModel) setSelectedModelId(rfModel._id);
                    }}
                    role="button"
                    tabIndex={hasLabels ? 0 : -1}
                    aria-label="Select Random Forest Gear Fault Classifier"
                  >
                    <div className="model-compat-card-header">
                      <span className="model-compat-name">
                        {rfModel?.name || 'Random Forest Gear Fault Classifier'}
                      </span>
                      <span className={`model-compat-badge ${hasLabels ? 'compatible' : 'incompatible'}`}>
                        {hasLabels ? 'COMPATIBLE · GROUND TRUTH LABELED' : 'REQUIRES LABELS'}
                      </span>
                    </div>
                    <p className="model-compat-desc">
                      Supervised multi-class fault classification (Normal, Gear Tooth Wear, Misalignment, Lubrication Loss) with local TreeSHAP feature attributions and probability breakdown.
                    </p>
                    <div className="model-compat-specs">
                      <span>Algorithm: Random Forest (n=100)</span>
                      <span>Target: Multi-Class Faults</span>
                      <span>Window: 64 samples</span>
                    </div>
                  </div>

                  {/* Model 2: Isolation Forest Anomaly Detector */}
                  <div
                    className={`model-compat-card ${selectedModelId === ifModel?._id ? 'selected' : ''}`}
                    onClick={() => {
                      if (ifModel) setSelectedModelId(ifModel._id);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label="Select Isolation Forest Anomaly Detector"
                  >
                    <div className="model-compat-card-header">
                      <span className="model-compat-name">
                        {ifModel?.name || 'Isolation Forest Anomaly Detector'}
                      </span>
                      <span className="model-compat-badge compatible">
                        COMPATIBLE · MULTIVARIATE TELEMETRY
                      </span>
                    </div>
                    <p className="model-compat-desc">
                      Unsupervised anomaly detection scoring sensor deviations against healthy baselines without requiring ground-truth fault labels.
                    </p>
                    <div className="model-compat-specs">
                      <span>Algorithm: Isolation Forest</span>
                      <span>Target: Out-of-Distribution Anomalies</span>
                      <span>Window: 64 samples</span>
                    </div>
                  </div>

                  {/* Model 3: Remaining Useful Life (RUL) Prognostics (Strictly Incompatible) */}
                  <div className="model-compat-card incompatible" aria-disabled="true">
                    <div className="model-compat-card-header">
                      <span className="model-compat-name">
                        Remaining Useful Life (RUL) Prognostics
                      </span>
                      <span className="model-compat-badge incompatible">
                        INCOMPATIBLE · RUN-TO-FAILURE REQUIRED
                      </span>
                    </div>
                    <p className="model-compat-desc">
                      Remaining Useful Life (RUL) estimation requires continuous run-to-failure degradation progression telemetry or timestamped wear cycle history (e.g. NASA C-MAPSS or IMS benchmarks). Incompatible with snapshot test datasets.
                    </p>
                    <div className="model-compat-specs">
                      <span>Architecture: Temporal Degradation Regression</span>
                      <span>Status: Unavailable for this dataset</span>
                    </div>
                  </div>
                </div>

                {/* Analysis In-Place Execution or Results Presentation */}
                {completedRun ? (
                  <div className="analysis-result-summary-card">
                    <div className="analysis-result-header">
                      <div className="analysis-result-title">
                        <Icon name="checkCircle" size={18} color="#0f766e" />
                        Model Analysis Execution Completed Successfully
                      </div>
                      <StatusBadge status="healthy" label="COMPLETED" />
                    </div>

                    <div className="analysis-result-metrics">
                      <div className="analysis-metric-tile">
                        <span className="analysis-metric-label">Model Executed</span>
                        <span className="analysis-metric-value" style={{ fontSize: '0.85rem' }}>
                          {completedRun.modelName}
                        </span>
                        <span className="analysis-metric-sub">Version {completedRun.modelVersion || '1.0.0'}</span>
                      </div>
                      <div className="analysis-metric-tile">
                        <span className="analysis-metric-label">Primary Inferred Class / State</span>
                        <span className="analysis-metric-value" style={{ color: 'var(--primary)', textTransform: 'capitalize' }}>
                          {completedRun.intervals?.[0]?.classification?.predictedClass ||
                            completedRun.intervals?.[0]?.predictedClass ||
                            (completedRun.summary?.maxAnomalyScore > 0.5 ? 'Elevated Anomaly' : 'Nominal Baseline')}
                        </span>
                        <span className="analysis-metric-sub">
                          Max Anomaly Score: {(completedRun.summary?.maxAnomalyScore ?? 0).toFixed(3)}
                        </span>
                      </div>
                      <div className="analysis-metric-tile">
                        <span className="analysis-metric-label">Windows Analyzed</span>
                        <span className="analysis-metric-value">
                          {completedRun.summary?.totalWindows || completedRun.intervals?.length || 3} windows
                        </span>
                        <span className="analysis-metric-sub">Window: 64 | Overlap: 50%</span>
                      </div>
                      <div className="analysis-metric-tile">
                        <span className="analysis-metric-label">Explainability</span>
                        <span className="analysis-metric-value" style={{ fontSize: '0.85rem', color: '#047857' }}>
                          TreeSHAP Computed
                        </span>
                        <span className="analysis-metric-sub">Feature attributions ready</span>
                      </div>
                    </div>

                    <div className="analysis-action-bar">
                      <Button
                        variant="primary"
                        onClick={() => navigate(`${ROUTES.ANALYSIS}?analysisRunId=${completedRun._id}`)}
                      >
                        View Full Explainable Report & SHAP Breakdown →
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setCompletedRun(null)}
                      >
                        Run Alternative Model on This Dataset
                      </Button>
                      <Button variant="ghost" onClick={handleReset}>
                        Upload New Dataset
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {analysisError && (
                      <AlertCallout
                        severity="critical"
                        title="Model Analysis Failed"
                        description={`${analysisError} Please check dataset column mappings or select an alternative compatible model.`}
                        style={{ marginBottom: '1rem' }}
                      />
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <Button
                        variant="primary"
                        onClick={() => handleRunCompatibleAnalysis()}
                        disabled={isAnalyzing || !selectedModelId}
                      >
                        {isAnalyzing ? (
                          <>
                            <Icon name="loader" size={13} className="spin" style={{ marginRight: 6 }} />
                            Running Model Analysis & TreeSHAP...
                          </>
                        ) : (
                          <>
                            <Icon name="play" size={13} style={{ marginRight: 6 }} />
                            Run Compatible Model Analysis
                          </>
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`${ROUTES.ANALYSIS}?datasetId=${confirmedDataset._id}`)}
                      >
                        Open Analysis Studio
                      </Button>
                      <Button
                        variant="secondary"
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
                      <Button variant="ghost" onClick={handleReset}>
                        Upload New Dataset
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </Card>
      ) : (
        /* Multi-Stage Upload Flow */
        <>
          {/* Storage Quota & Limits Bar */}
          {storageQuota && (
            <div className="storage-quota-card upload-reveal-section upload-stagger-1">
              <div className="storage-quota-header">
                <span className="storage-quota-title">
                  <Icon name="database" size={15} color="var(--primary)" />
                  Factory Research Storage Quota & File Limits
                </span>
                <span className="storage-quota-text">
                  Used: <strong>{(storageQuota.currentUsedBytes / (1024 * 1024)).toFixed(1)} MB</strong> /{' '}
                  <strong>{(storageQuota.factoryQuotaBytes / (1024 * 1024 * 1024)).toFixed(1)} GB</strong> (
                  {Math.round((storageQuota.currentUsedBytes / storageQuota.factoryQuotaBytes) * 100)}%) •{' '}
                  Remaining: <strong>{(storageQuota.remainingQuotaBytes / (1024 * 1024)).toFixed(1)} MB</strong>
                </span>
              </div>
              <div className="storage-quota-bar-wrap">
                <div
                  className={`storage-quota-bar-fill ${
                    (storageQuota.currentUsedBytes / storageQuota.factoryQuotaBytes) > 0.9
                      ? 'danger'
                      : (storageQuota.currentUsedBytes / storageQuota.factoryQuotaBytes) > 0.7
                      ? 'warning'
                      : ''
                  }`}
                  style={{
                    width: `${Math.min(100, Math.round((storageQuota.currentUsedBytes / storageQuota.factoryQuotaBytes) * 100))}%`
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                <span>Research Benchmark Datasets: <strong>Up to 1 GB</strong> (.csv, .txt, .zip, .tar.gz, .tgz, .gz)</span>
                <span>Operational Machine Telemetry: <strong>Up to 50 MB</strong> (.csv, .txt)</span>
              </div>
            </div>
          )}

          {/* Stage 1 & 2: Target Selection & CSV Upload */}
          <div className="upload-stages-grid upload-reveal-section upload-stagger-2">
            {/* Stage 1: Target & Provenance Selection */}
            <Card
              title="1. Dataset Provenance & Target Specimen"
              subtitle="Specify telemetry origin from factory floor equipment or an external benchmark repository"
            >
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" id="provenance-group-label" style={{ marginBottom: '0.35rem' }}>
                  Dataset Provenance Category *
                </label>
                <span className="text-muted" style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.65rem' }}>
                  Choose whether this recording represents live shop-floor machinery or a public validation dataset.
                </span>

                <div className="provenance-options-grid" role="radiogroup" aria-labelledby="provenance-group-label">
                  <label
                    htmlFor="provenance-operational"
                    className={`provenance-card ${datasetType === DATASET_TYPES.OPERATIONAL && !isSimulatorDerived ? 'selected' : ''}`}
                  >
                    <div className="provenance-card-header">
                      <input
                        type="radio"
                        name="datasetType"
                        id="provenance-operational"
                        value={DATASET_TYPES.OPERATIONAL}
                        checked={datasetType === DATASET_TYPES.OPERATIONAL && !isSimulatorDerived}
                        onChange={() => {
                          setDatasetType(DATASET_TYPES.OPERATIONAL);
                          setIsSimulatorDerived(false);
                        }}
                        className="provenance-radio-input"
                      />
                      <div className="provenance-badge-icon">
                        <Icon name="activity" size={15} />
                      </div>
                    </div>
                    <div className="provenance-card-body">
                      <span className="provenance-title">Operational Equipment Run</span>
                      <p className="provenance-desc">
                        Field telemetry logged from an authorized gearbox specimen on the factory production line.
                      </p>
                    </div>
                    <div className="provenance-card-footer">
                      <span className="provenance-scope-tag">Factory Equipment</span>
                    </div>
                  </label>

                  <label
                    htmlFor="provenance-simulator"
                    className={`provenance-card ${isSimulatorDerived || datasetType === 'simulator' ? 'selected' : ''}`}
                  >
                    <div className="provenance-card-header">
                      <input
                        type="radio"
                        name="datasetType"
                        id="provenance-simulator"
                        value="simulator"
                        checked={isSimulatorDerived || datasetType === 'simulator'}
                        onChange={() => {
                          setDatasetType('simulator');
                          setIsSimulatorDerived(true);
                        }}
                        className="provenance-radio-input"
                      />
                      <div className="provenance-badge-icon" style={{ background: 'rgba(217, 119, 6, 0.12)', color: '#D97706' }}>
                        <Icon name="machine" size={15} />
                      </div>
                    </div>
                    <div className="provenance-card-body">
                      <span className="provenance-title">Simulator Telemetry (Digital Twin)</span>
                      <p className="provenance-desc">
                        Deterministic 15-channel powertrain dynamics from the 3D transmission simulator. Labeled [SIMULATED].
                      </p>
                    </div>
                    <div className="provenance-card-footer">
                      <span className="provenance-scope-tag" style={{ background: 'rgba(217, 119, 6, 0.15)', color: '#D97706', fontWeight: 700 }}>
                        SIMULATED
                      </span>
                    </div>
                  </label>

                  <label
                    htmlFor="provenance-reference"
                    className={`provenance-card ${datasetType === DATASET_TYPES.REFERENCE ? 'selected' : ''} ${!isManager ? 'disabled' : ''}`}
                  >
                    <div className="provenance-card-header">
                      <input
                        type="radio"
                        name="datasetType"
                        id="provenance-reference"
                        value={DATASET_TYPES.REFERENCE}
                        checked={datasetType === DATASET_TYPES.REFERENCE}
                        disabled={!isManager}
                        onChange={() => {
                          setDatasetType(DATASET_TYPES.REFERENCE);
                          setIsSimulatorDerived(false);
                        }}
                        className="provenance-radio-input"
                      />
                      <div className="provenance-badge-icon">
                        <Icon name="research" size={15} />
                      </div>
                    </div>
                    <div className="provenance-card-body">
                      <span className="provenance-title">Research / Benchmark Catalog</span>
                      <p className="provenance-desc">
                        {isManager
                          ? 'Curated public research dataset (e.g. CWRU Bearing Rig, NASA IMS) for model baseline evaluation.'
                          : 'Manager only: Register external research benchmark datasets with license verification.'}
                      </p>
                    </div>
                    <div className="provenance-card-footer">
                      <span className="provenance-scope-tag">
                        {isManager ? 'Research Benchmark' : 'Manager Scope'}
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {(datasetType === DATASET_TYPES.OPERATIONAL || datasetType === 'simulator') ? (
                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label" htmlFor="machine-target-select">
                    Target Factory Machine Specimen *
                  </label>
                  <span className="text-muted" style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.45rem' }}>
                    Select the monitored transmission asset to link this dataset's telemetry to.
                  </span>
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

              <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
                <label className="form-label" htmlFor="dataset-title-input">
                  Dataset Title *
                </label>
                <span className="text-muted" style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.45rem' }}>
                  A clear identification name for this recording run or test specimen snapshot.
                </span>
                <input
                  id="dataset-title-input"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Extruder Gearbox High-Load Vibration Run"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="dataset-desc-input">
                  Operational Notes & Operating Context (Optional)
                </label>
                <span className="text-muted" style={{ fontSize: '0.78rem', display: 'block', marginBottom: '0.45rem' }}>
                  Document speed RPM, mechanical load, ambient temperature, lubricant grade, or shift observations.
                </span>
                <textarea
                  id="dataset-desc-input"
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
              title="2. Select & Upload Telemetry Dataset"
              subtitle="Files are processed via streaming chunks; server never buffers 1 GB in memory or fetches arbitrary URLs"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={datasetType === DATASET_TYPES.REFERENCE ? '.csv,.txt,.zip,.tar.gz,.tgz,.gz' : '.csv,.txt'}
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />

              {!selectedFile ? (
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
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                >
                  <div className="dropzone-icon-circle" aria-hidden="true">
                    <Icon name="upload" size={26} color="var(--primary)" />
                  </div>
                  <div className="dropzone-title">
                    Drag & drop your {datasetType === DATASET_TYPES.REFERENCE ? 'research file or archive' : 'CSV telemetry file'} here, or browse
                  </div>
                  <p className="dropzone-subtitle">
                    {datasetType === DATASET_TYPES.REFERENCE
                      ? 'Upload large research datasets or archives (up to 1 GB) with resumable chunk streaming and safe decompression limits.'
                      : 'Select operational time-series telemetry or vibration recording files (up to 50 MB).'}
                  </p>
                  <div className="dropzone-meta-tags">
                    <span className="dropzone-meta-pill">
                      Formats: {datasetType === DATASET_TYPES.REFERENCE ? '.csv, .txt, .zip, .tar.gz, .tgz, .gz' : '.csv, .txt'}
                    </span>
                    <span className="dropzone-meta-pill">
                      Max Size: {datasetType === DATASET_TYPES.REFERENCE ? '1 GB' : '50 MB'}
                    </span>
                    <span className="dropzone-meta-pill">Resumable 5 MB Chunks</span>
                  </div>
                  <div className="dropzone-btn-action">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      icon="upload"
                    >
                      Browse Local Files
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="upload-dropzone has-file">
                  <div className="selected-file-panel">
                    <div className="selected-file-info">
                      <div className="selected-file-icon">
                        <Icon name="file" size={22} color="var(--primary)" />
                      </div>
                      <div className="selected-file-details">
                        <div className="selected-file-name mono-code">{selectedFile.name}</div>
                        <div className="selected-file-meta">
                          <span>
                            {selectedFile.size >= 1024 * 1024 * 1024
                              ? `${(selectedFile.size / (1024 * 1024 * 1024)).toFixed(2)} GB`
                              : `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`}
                          </span>
                          <span>•</span>
                          <span>{Math.ceil(selectedFile.size / DEFAULT_CHUNK_SIZE_BYTES)} Chunks (5 MB each)</span>
                          <span>•</span>
                          <span style={{ color: 'var(--status-healthy)', fontWeight: 600 }}>Ready for Ingestion</span>
                        </div>
                      </div>
                    </div>
                    <div className="selected-file-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={uploading || Boolean(activeJob)}
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        Change File
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={uploading || Boolean(activeJob)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReset();
                        }}
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {/* Resumable Chunked Upload Progress Box */}
                  {uploading && (
                    <div className="chunk-progress-box">
                      <div className="chunk-progress-header">
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {uploadPaused ? 'Upload Paused' : 'Streaming Chunks to Server...'}
                        </span>
                        <span className="chunk-progress-pct">{uploadProgress}%</span>
                      </div>
                      <div className="chunk-progress-bar-wrap">
                        <div className="chunk-progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
                      </div>
                      <div className="chunk-metrics-row">
                        <span>
                          Transferred: {(uploadedBytes / (1024 * 1024)).toFixed(1)} MB of{' '}
                          {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                        <span>Speed: {uploadSpeed || 'Connecting...'}</span>
                        <span>{uploadEta !== null ? `ETA: ~${uploadEta}s` : ''}</span>
                        <span>
                          Chunk {Math.min(Math.ceil(selectedFile.size / DEFAULT_CHUNK_SIZE_BYTES), Math.floor(uploadedBytes / DEFAULT_CHUNK_SIZE_BYTES) + 1)} of {Math.ceil(selectedFile.size / DEFAULT_CHUNK_SIZE_BYTES)}
                        </span>
                      </div>
                      <div className="chunk-controls-row">
                        {uploadPaused ? (
                          <Button variant="secondary" size="sm" onClick={handleResumeUpload}>
                            Resume Upload
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={handlePauseUpload}>
                            Pause Upload
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={handleCancelUpload} style={{ color: '#ef4444' }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Background Stream Processing Job Card */}
                  {activeJob && (
                    <div className="job-monitoring-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            Background Stream Profiling & Ingestion
                          </span>
                          <div className="mono-code text-muted" style={{ fontSize: '0.74rem' }}>
                            Job ID: {activeJob.jobId}
                          </div>
                        </div>
                        <StatusBadge
                          status={
                            activeJob.status === 'complete'
                              ? 'healthy'
                              : activeJob.status === 'failed'
                              ? 'critical'
                              : activeJob.status === 'cancelled'
                              ? 'warning'
                              : 'info'
                          }
                          label={activeJob.status?.toUpperCase()}
                        />
                      </div>

                      {/* 5-Stage Stepper */}
                      <div className="job-stepper">
                        {jobStagesList.map((st, idx) => {
                          const currentStep = getStageStep(activeJob.stage);
                          const isComplete = activeJob.status === 'complete' || idx < currentStep;
                          const isActive = activeJob.status === 'processing' && idx === currentStep;

                          return (
                            <div
                              key={st.key}
                              className={`job-step-item ${isComplete ? 'complete' : ''} ${isActive ? 'active' : ''}`}
                            >
                              <div className="job-step-indicator">
                                {isComplete ? '✓' : idx + 1}
                              </div>
                              <span className="job-step-label">{st.label}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Progress Bar */}
                      <div className="chunk-progress-bar-wrap" style={{ height: 6, margin: '0.5rem 0' }}>
                        <div
                          className="chunk-progress-bar-fill"
                          style={{
                            width: `${activeJob.progress || (activeJob.status === 'complete' ? 100 : 10)}%`
                          }}
                        />
                      </div>

                      {/* Current Stage Message */}
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                        <span>
                          <Icon name="activity" size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                          {activeJob.stageMessage || 'Processing dataset...'}
                        </span>
                        <span className="mono-code" style={{ fontWeight: 600 }}>{activeJob.progress || 0}%</span>
                      </div>

                      {/* Job Metrics Row */}
                      {activeJob.metrics && (
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                          {activeJob.metrics.totalRows !== undefined && (
                            <div>Rows: <strong className="mono-code">{activeJob.metrics.totalRows.toLocaleString()}</strong></div>
                          )}
                          {activeJob.metrics.processedBytes !== undefined && (
                            <div>Processed: <strong className="mono-code">{(activeJob.metrics.processedBytes / (1024 * 1024)).toFixed(1)} MB</strong></div>
                          )}
                          {activeJob.metrics.durationMs !== undefined && (
                            <div>Duration: <strong className="mono-code">{Math.round(activeJob.metrics.durationMs / 1000)}s</strong></div>
                          )}
                        </div>
                      )}

                      {/* Job Actions */}
                      {(activeJob.status === 'processing' || activeJob.status === 'queued') && (
                        <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                          <Button variant="ghost" size="sm" onClick={handleCancelJob} style={{ color: '#ef4444' }}>
                            Cancel Job
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {!uploadedSession && !uploading && !activeJob && (
                    <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant="primary"
                        onClick={handleChunkedUpload}
                        style={{ minWidth: 220 }}
                      >
                        Start Resumable Upload & Ingest ({Math.ceil(selectedFile.size / DEFAULT_CHUNK_SIZE_BYTES)} Chunks)
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {uploadError && (
                <div style={{ marginTop: '0.85rem' }}>
                  <AlertCallout severity="critical" title="Upload Failed" description={uploadError} />
                </div>
              )}

              {uploadedSession && (
                <div className="upload-success-panel" style={{ marginTop: '1rem', padding: '1rem 1.25rem', background: 'var(--bg-surface-subtle)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="table-primary-text" style={{ fontWeight: 600 }}>File Successfully Uploaded & Parsed</span>
                    <StatusBadge status="healthy" label="UPLOADED" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '0.65rem', fontSize: '0.85rem' }}>
                    <div><span className="text-muted">Detected Rows:</span> <strong>{uploadedSession.totalRows?.toLocaleString()}</strong></div>
                    <div><span className="text-muted">Columns:</span> <strong>{uploadedSession.totalColumns}</strong></div>
                    <div><span className="text-muted">Delimiter:</span> <code className="mono-code">&apos;{uploadedSession.delimiter}&apos;</code></div>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Stage 3: Column Mapping & Preview */}
          {uploadedSession && (
            <div className="upload-reveal-section upload-stagger-3" style={{ marginTop: '1.5rem' }}>
              <Card
                title="3. Map Sensor Signals & Physical Units"
                subtitle="Map detected CSV columns to normalized gearbox physical channels"
                badge={<StatusBadge status="info" label={`${uploadedSession.headers.length} Columns Detected`} />}
              >
                {(isSimulatorDerived || datasetType === 'simulator') && (
                  <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(217, 119, 6, 0.08)', borderRadius: '6px', border: '1px solid rgba(217, 119, 6, 0.25)', fontSize: '0.82rem', color: '#92400E' }}>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                      <span className="badge" style={{ backgroundColor: '#D97706', color: '#FFFFFF', fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>
                        SIMULATOR SIGNATURE DETECTED
                      </span>
                      15-Channel Powertrain Telemetry Format
                    </div>
                    <div>
                      <code>vib_rms</code> is mapped to <code>vibration_input_radial</code> (mm/s), <code>gearbox_in_rpm</code> to <code>rotational_speed</code> (RPM), <code>torque_nm</code> to <code>load_torque</code> (Nm), and <code>coolant_c</code> to <code>temp_gearbox_sump</code> (°C). All resulting records will be permanently labeled <strong>[SIMULATED]</strong>.
                    </div>
                  </div>
                )}
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
            </div>
          )}

          {/* Stage 4: Validation Findings & AI Compatibility Review */}
          {validationResult && (
            <div className="upload-reveal-section upload-stagger-3" style={{ marginTop: '1.5rem' }}>
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
          </div>
          )}

          {/* Recently Ingested Datasets Ledger */}
          <div className="upload-reveal-section upload-stagger-4" style={{ marginTop: '1.5rem' }}>
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
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              {d.status === 'ready' && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => navigate(`${ROUTES.ANALYSIS}?datasetId=${d._id}`)}
                                >
                                  <Icon name="play" size={12} style={{ marginRight: 4 }} /> Analyze
                                </Button>
                              )}
                              <a
                                href={`${API_BASE}/datasets/${d._id}/download`}
                                download
                                className="btn btn-secondary btn-sm"
                                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <Icon name="download" size={13} />
                                <span>CSV</span>
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
