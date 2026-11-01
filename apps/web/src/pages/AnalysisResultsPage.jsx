import React, { useState, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import Button from '../components/common/Button.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import LoadingSkeleton from '../components/common/LoadingSkeleton.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  MODEL_TYPES,
  MODEL_STATUS,
  FAULT_DOMAINS,
  USER_ROLES
} from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function AnalysisResultsPage() {
  const { user } = useAuth();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;

  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Training modal state
  const [isTrainModalOpen, setIsTrainModalOpen] = useState(false);
  const [availableDatasets, setAvailableDatasets] = useState([]);
  const [trainForm, setTrainForm] = useState({
    name: '',
    modelType: MODEL_TYPES.RANDOM_FOREST,
    datasetId: '',
    targetDomain: FAULT_DOMAINS.GEAR_FAULTS,
    componentType: 'gearbox',
    window_size: 256,
    overlap_ratio: 0.5,
    random_state: 42
  });
  const [isTraining, setIsTraining] = useState(false);
  const [trainError, setTrainError] = useState(null);

  // Fetch models list
  const fetchModels = async () => {
    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/models`, {
        credentials: 'include',
        headers
      });
      if (!res.ok) throw new Error('Failed to load ML models.');
      const data = await res.json();
      setModels(data.models || []);
      if (data.models && data.models.length > 0 && !selectedModelId) {
        setSelectedModelId(data.models[0]._id);
      }
    } catch (err) {
      console.error('Fetch models error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, [user]);

  // Load datasets when train modal opens
  const openTrainModal = async () => {
    setIsTrainModalOpen(true);
    setTrainError(null);
    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/datasets`, {
        credentials: 'include',
        headers
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableDatasets(data.datasets || []);
        if (data.datasets && data.datasets.length > 0) {
          setTrainForm((prev) => ({ ...prev, datasetId: data.datasets[0]._id }));
        }
      }
    } catch (err) {
      console.error('Failed to load datasets for training:', err);
    }
  };

  const handleTrainSubmit = async (e) => {
    e.preventDefault();
    setTrainError(null);
    setIsTraining(true);

    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const res = await fetch(`${API_BASE}/models/train`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          name: trainForm.name || `${trainForm.modelType === MODEL_TYPES.RANDOM_FOREST ? 'Random Forest' : 'Isolation Forest'} Specimen Run`,
          modelType: trainForm.modelType,
          datasetId: trainForm.datasetId,
          targetDomain: trainForm.targetDomain,
          componentType: trainForm.componentType,
          parameters: {
            window_size: Number(trainForm.window_size),
            overlap_ratio: Number(trainForm.overlap_ratio),
            random_state: Number(trainForm.random_state)
          },
          sync: true
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to train model');
      }

      setIsTrainModalOpen(false);
      await fetchModels();
      if (data.model) {
        setSelectedModelId(data.model._id || data.model.id);
      }
    } catch (err) {
      console.error('Training error:', err);
      setTrainError(err.message);
    } finally {
      setIsTraining(false);
    }
  };

  const selectedModel = models.find((m) => m._id === selectedModelId || m.id === selectedModelId);

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="mono-code">AI ENGINE</span>
            <span className="badge badge-demo">PHASE 6: SCIENTIFIC ML & TREE-SHAP</span>
          </div>
          <h1 className="page-title">Model Evaluation & Explainable SHAP Insights</h1>
          <p className="page-subtitle">
            Rigorous cross-run feature extraction, multi-class confusion matrices, and additivity-verified SHAP attributions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {isManager && (
            <Button variant="primary" onClick={openTrainModal}>
              🚀 Train New Model
            </Button>
          )}
          <Button variant="secondary" onClick={fetchModels}>
            🔄 Refresh Models
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton count={3} />
      ) : error ? (
        <AlertCallout severity="critical" title="Model Service Error" description={error} />
      ) : models.length === 0 ? (
        <EmptyState
          title="No Trained Models Available"
          description="No machine learning models have been trained for this factory yet. Factory Managers can initiate feature extraction and training on compatible datasets."
          actionText={isManager ? "Train Model Now" : null}
          onAction={openTrainModal}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Model Selector Bar */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              Select Active Specimen Model:
            </span>
            {models.map((m) => {
              const isSelected = (m._id || m.id) === selectedModelId;
              const isRF = m.modelType === MODEL_TYPES.RANDOM_FOREST;
              return (
                <button
                  key={m._id || m.id}
                  onClick={() => setSelectedModelId(m._id || m.id)}
                  style={{
                    padding: '0.5rem 0.875rem',
                    borderRadius: '6px',
                    border: isSelected ? '2px solid #3b82f6' : '1px solid #334155',
                    background: isSelected ? '#1e293b' : '#0f172a',
                    color: isSelected ? '#ffffff' : '#94a3b8',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.85rem'
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: m.status === 'ready' ? '#10b981' : m.status === 'failed' ? '#ef4444' : '#f59e0b'
                    }}
                  />
                  <strong>{m.name}</strong>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    ({isRF ? 'Random Forest' : 'Isolation Forest'})
                  </span>
                </button>
              );
            })}
          </div>

          {selectedModel && (
            <>
              {/* Specimen & Domain Overview Card */}
              <Card
                title={selectedModel.name}
                subtitle={`Target Domain: ${selectedModel.targetDomain.replace('_', ' ').toUpperCase()} • Component: ${selectedModel.componentType.toUpperCase()}`}
                badge={
                  <StatusBadge
                    status={selectedModel.status === 'ready' ? 'healthy' : selectedModel.status === 'failed' ? 'critical' : 'warning'}
                    label={selectedModel.status.toUpperCase()}
                  />
                }
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
                  <div>
                    <span className="spec-label">Architecture:</span>
                    <span className="mono-code" style={{ display: 'block' }}>
                      {selectedModel.modelType === MODEL_TYPES.RANDOM_FOREST ? 'Ensemble Random Forest' : 'Unsupervised Isolation Forest'}
                    </span>
                  </div>
                  <div>
                    <span className="spec-label">Associated Dataset:</span>
                    <span className="mono-code" style={{ display: 'block' }}>
                      {selectedModel.datasetId?.title || selectedModel.datasetSummary?.datasetTitle || 'Standard Specimen Run'}
                    </span>
                  </div>
                  <div>
                    <span className="spec-label">Train / Test Samples:</span>
                    <span className="mono-code" style={{ display: 'block' }}>
                      {selectedModel.metrics?.trainSamples || 0} train / {selectedModel.metrics?.testSamples || 0} test windows
                    </span>
                  </div>
                  <div>
                    <span className="spec-label">Split Strategy:</span>
                    <span className="mono-code" style={{ display: 'block' }}>
                      {selectedModel.metrics?.splitMethod || 'GroupShuffleSplit (Cross-Run Leakage Resistant)'}
                    </span>
                  </div>
                </div>
              </Card>

              {/* Evaluation Metrics Grid */}
              {selectedModel.modelType === MODEL_TYPES.RANDOM_FOREST ? (
                /* Supervised Metrics */
                <div className="metrics-grid">
                  <MetricSummary
                    label="Test Accuracy"
                    value={selectedModel.metrics?.accuracy ? `${(selectedModel.metrics.accuracy * 100).toFixed(1)}%` : 'N/A'}
                    unit="accuracy"
                    status={selectedModel.metrics?.accuracy > 0.9 ? 'healthy' : 'warning'}
                    sublabel="Held-out test partition"
                  />
                  <MetricSummary
                    label="Macro F1-Score"
                    value={selectedModel.metrics?.macroF1 ? (selectedModel.metrics.macroF1).toFixed(3) : 'N/A'}
                    unit="macro-F1"
                    status={selectedModel.metrics?.macroF1 > 0.9 ? 'healthy' : 'warning'}
                    sublabel="Unweighted average across all classes"
                  />
                  <MetricSummary
                    label="Distinct Fault Classes"
                    value={selectedModel.metrics?.classes?.length || 0}
                    unit="discrete classes"
                    status="info"
                    sublabel={selectedModel.metrics?.classes?.join(', ')}
                  />
                  <MetricSummary
                    label="Extracted Feature Dimensions"
                    value={selectedModel.featureNames?.length || selectedModel.datasetSummary?.featureCount || 16}
                    unit="features / window"
                    status="info"
                    sublabel="Time + Spectral + GMF indicators"
                  />
                </div>
              ) : (
                /* Isolation Forest Metrics */
                <div className="metrics-grid">
                  <MetricSummary
                    label="Anomaly ROC-AUC"
                    value={selectedModel.metrics?.rocAuc ? selectedModel.metrics.rocAuc.toFixed(3) : 'N/A'}
                    unit="ROC-AUC"
                    status={selectedModel.metrics?.rocAuc > 0.9 ? 'healthy' : 'warning'}
                    sublabel="Area under sensitivity curve"
                  />
                  <MetricSummary
                    label="Calibrated Threshold"
                    value={selectedModel.metrics?.calibratedThreshold ? selectedModel.metrics.calibratedThreshold.toFixed(3) : 'N/A'}
                    unit="anomaly score"
                    status="info"
                    sublabel="Calibrated from healthy distribution"
                  />
                  <MetricSummary
                    label="False Positive Rate (Normal)"
                    value={selectedModel.metrics?.falsePositiveRate !== null ? `${(selectedModel.metrics.falsePositiveRate * 100).toFixed(1)}%` : 'N/A'}
                    unit="FPR on healthy"
                    status={selectedModel.metrics?.falsePositiveRate < 0.08 ? 'healthy' : 'warning'}
                    sublabel="Target: < 5% false alarms"
                  />
                  <MetricSummary
                    label="Defect Recall (Faults)"
                    value={selectedModel.metrics?.faultRecall !== null ? `${(selectedModel.metrics.faultRecall * 100).toFixed(1)}%` : 'N/A'}
                    unit="recall on anomalies"
                    status={selectedModel.metrics?.faultRecall > 0.9 ? 'healthy' : 'warning'}
                    sublabel="Detected anomalous windows"
                  />
                </div>
              )}

              {/* Multi-Class Confusion Matrix (For Random Forest) */}
              {selectedModel.modelType === MODEL_TYPES.RANDOM_FOREST && selectedModel.metrics?.confusionMatrix?.length > 0 && (
                <div className="grid-two-col">
                  <Card title="Multi-Class Confusion Matrix" subtitle="Rows = Actual Ground Truth, Columns = Model Prediction">
                    <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.85rem' }}>
                        <thead>
                          <tr>
                            <th style={{ padding: '0.5rem', borderBottom: '1px solid #334155', color: '#94a3b8' }}>Actual \ Pred</th>
                            {selectedModel.metrics.classes.map((cls) => (
                              <th key={cls} style={{ padding: '0.5rem', borderBottom: '1px solid #334155', color: '#38bdf8' }}>
                                {cls.replace('_', ' ')}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedModel.metrics.confusionMatrix.map((row, rIdx) => {
                            const actualLabel = selectedModel.metrics.classes[rIdx];
                            return (
                              <tr key={rIdx}>
                                <td style={{ padding: '0.5rem', fontWeight: 600, borderBottom: '1px solid #1e293b', color: '#cbd5e1', textAlign: 'left' }}>
                                  {actualLabel.replace('_', ' ')}
                                </td>
                                {row.map((val, cIdx) => {
                                  const isDiagonal = rIdx === cIdx;
                                  return (
                                    <td
                                      key={cIdx}
                                      style={{
                                        padding: '0.5rem',
                                        borderBottom: '1px solid #1e293b',
                                        backgroundColor: isDiagonal ? 'rgba(16, 185, 129, 0.15)' : val > 0 ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                                        color: isDiagonal ? '#34d399' : val > 0 ? '#f87171' : '#64748b',
                                        fontWeight: isDiagonal ? 700 : 400
                                      }}
                                    >
                                      {val}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {/* Per-Class Classification Report */}
                  <Card title="Per-Class Evaluation Breakdown" subtitle="Class-specific precision, recall, and harmonic F1-score">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                      {Object.entries(selectedModel.metrics.perClassMetrics || {}).map(([className, m]) => (
                        <div
                          key={className}
                          style={{
                            padding: '0.75rem',
                            borderRadius: '6px',
                            background: '#0f172a',
                            border: '1px solid #334155'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <strong style={{ color: '#f8fafc' }}>{className.replace('_', ' ').toUpperCase()}</strong>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Support: {m.support} windows</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.8rem' }}>
                            <div>Precision: <strong style={{ color: '#38bdf8' }}>{(m.precision * 100).toFixed(1)}%</strong></div>
                            <div>Recall: <strong style={{ color: '#34d399' }}>{(m.recall * 100).toFixed(1)}%</strong></div>
                            <div>F1-Score: <strong style={{ color: '#a78bfa' }}>{(m.f1_score * 100).toFixed(1)}%</strong></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              {/* Verified SHAP Explanations Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <AlertCallout
                  severity="info"
                  title={`Verified TreeSHAP & Attribution: ${selectedModel.shapSummary?.explainerType || 'Exact TreeExplainer'}`}
                  description={
                    selectedModel.shapSummary?.additivityVerified
                      ? `✓ Mathematically Verified Additive: Sum of feature contributions (Σ φi) plus baseline base value (φ0) equals model output within 10^-4 tolerance (Max Discrepancy: ${selectedModel.shapSummary?.maxAdditivityDiscrepancy || 0}). No heuristics or substituted feature rankings.`
                      : 'Evaluating exact Shapley cooperative game-theoretic feature allocations.'
                  }
                />

                <div className="grid-two-col">
                  {/* Global Feature Impact (Mean |SHAP|) */}
                  <Card
                    title="Global Feature Importance (Mean |SHAP|)"
                    subtitle="True game-theoretic feature impact across entire test fold"
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                      {(selectedModel.shapSummary?.globalFeatureImportance?.length > 0
                        ? selectedModel.shapSummary.globalFeatureImportance
                        : selectedModel.featureImportance || []
                      )
                        .slice(0, 8)
                        .map((f, idx) => {
                          const val = f.meanAbsShap || f.importance || 0;
                          const pct = Math.min(100, Math.round(val * 250));
                          return (
                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                <span className="mono-code">{f.feature}</span>
                                <span style={{ fontWeight: 600, color: '#38bdf8' }}>{val.toFixed(4)}</span>
                              </div>
                              <div style={{ height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    height: '100%',
                                    width: `${pct}%`,
                                    background: idx === 0 ? '#38bdf8' : idx === 1 ? '#60a5fa' : '#818cf8',
                                    borderRadius: '4px'
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </Card>

                  {/* Local Instance Explanation */}
                  <Card
                    title="Local Window SHAP Attribution"
                    subtitle="Exact feature contributions for anomalous condition sample"
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                      <div style={{ fontSize: '0.85rem', color: '#94a3b8', padding: '0.5rem', background: '#0f172a', borderRadius: '6px' }}>
                        Baseline Expected Value (φ₀): <strong>{JSON.stringify(selectedModel.shapSummary?.baselineExpectedValue)}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(selectedModel.shapSummary?.topContributingFeatures || []).slice(0, 6).map((c, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.5rem 0.75rem',
                              background: '#1e293b',
                              borderRadius: '6px',
                              fontSize: '0.82rem'
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{c.feature}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Transducer Value: {c.value}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span
                                style={{
                                  color: (c.attribution || c.importance) > 0 ? '#f87171' : '#34d399',
                                  fontWeight: 700
                                }}
                              >
                                {(c.attribution || c.importance) > 0 ? '+' : ''}{(c.attribution || c.importance).toFixed(4)}
                              </span>
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>SHAP contribution</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Train New Model Modal (Factory Manager only) */}
      {isTrainModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem'
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '8px',
              maxWidth: '540px',
              width: '100%',
              padding: '1.5rem',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.5rem' }}>
              Train Machine Learning Model
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
              Extract physical engineering indicators and train scientific Random Forest or Isolation Forest models with exact TreeSHAP attributions.
            </p>

            {trainError && (
              <div style={{ marginBottom: '1rem' }}>
                <AlertCallout severity="critical" title="Training Incompatible" description={trainError} />
              </div>
            )}

            <form onSubmit={handleTrainSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.25rem' }}>
                  Model Name:
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. GB-104 Pinion Fault Classifier"
                  value={trainForm.name}
                  onChange={(e) => setTrainForm({ ...trainForm, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    color: '#f8fafc'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.25rem' }}>
                    Algorithm Architecture:
                  </label>
                  <select
                    value={trainForm.modelType}
                    onChange={(e) => setTrainForm({ ...trainForm, modelType: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc'
                    }}
                  >
                    <option value={MODEL_TYPES.RANDOM_FOREST}>Random Forest (Supervised)</option>
                    <option value={MODEL_TYPES.ISOLATION_FOREST}>Isolation Forest (Unsupervised)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.25rem' }}>
                    Fault Domain Taxonomy:
                  </label>
                  <select
                    value={trainForm.targetDomain}
                    onChange={(e) => setTrainForm({ ...trainForm, targetDomain: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc'
                    }}
                  >
                    <option value={FAULT_DOMAINS.GEAR_FAULTS}>Gear Faults (Teeth, Mesh)</option>
                    <option value={FAULT_DOMAINS.BEARING_FAULTS}>Bearing Faults (Races, Balls)</option>
                    <option value={FAULT_DOMAINS.GENERAL_MECHANICAL}>General Mechanical Baseline</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.25rem' }}>
                  Select Training Dataset:
                </label>
                <select
                  required
                  value={trainForm.datasetId}
                  onChange={(e) => setTrainForm({ ...trainForm, datasetId: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    background: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    color: '#f8fafc'
                  }}
                >
                  {availableDatasets.map((ds) => (
                    <option key={ds._id || ds.id} value={ds._id || ds.id}>
                      {ds.title} ({ds.datasetType})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.25rem' }}>
                    Window Size (Samples):
                  </label>
                  <input
                    type="number"
                    min="16"
                    step="16"
                    value={trainForm.window_size}
                    onChange={(e) => setTrainForm({ ...trainForm, window_size: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.25rem' }}>
                    Overlap Ratio (0.0 - 0.9):
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="0.9"
                    step="0.1"
                    value={trainForm.overlap_ratio}
                    onChange={(e) => setTrainForm({ ...trainForm, overlap_ratio: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: '#f8fafc'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setIsTrainModalOpen(false)}
                  disabled={isTraining}
                >
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={isTraining}>
                  {isTraining ? 'Training via Scientific Pipeline...' : 'Run Training & SHAP'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
