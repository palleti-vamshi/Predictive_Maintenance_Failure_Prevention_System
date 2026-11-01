import React, { useState, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';
import Button from '../components/common/Button.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../router/Router.jsx';
import { DATASET_TYPES, AI_TASK_TYPES } from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function ResearchBenchmarkPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();

  // Tab switch: 'catalog' vs 'algorithms'
  const [activeTab, setActiveTab] = useState('catalog');

  // Reference catalog state
  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [errorCatalog, setErrorCatalog] = useState(null);

  // Benchmark models state
  const [benchmarkModels, setBenchmarkModels] = useState([]);

  // Algorithm sensitivity simulator slider: pinion vibration (mm/s)
  const [pinionVib, setPinionVib] = useState(4.2);

  // Compute simulated Isolation Forest anomaly score (0 to 1) based on distance to baseline 2.8 mm/s
  const baseline = 2.8;
  const deviation = Math.max(0, pinionVib - baseline);
  const simulatedScore = Math.min(1.0, (deviation / 2.5) * 0.7 + 0.15).toFixed(3);
  const isAnomaly = simulatedScore > 0.45;

  useEffect(() => {
    async function fetchData() {
      setLoadingCatalog(true);
      setErrorCatalog(null);
      try {
        const token = user?.sessionToken || localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const [catRes, modRes] = await Promise.all([
          fetch(`${API_BASE}/datasets/reference-catalog`, { credentials: 'include', headers }),
          fetch(`${API_BASE}/models`, { credentials: 'include', headers })
        ]);

        if (catRes.ok) {
          const data = await catRes.json();
          setCatalog(data.datasets || []);
        } else {
          throw new Error('Failed to load reference dataset catalog');
        }

        if (modRes.ok) {
          const mData = await modRes.json();
          setBenchmarkModels(mData.models || []);
        }
      } catch (err) {
        console.error('Fetch error:', err);
        setErrorCatalog(err.message || 'Error loading benchmark data');
      } finally {
        setLoadingCatalog(false);
      }
    }
    fetchData();
  }, [user]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-demo">RESEARCH & EVALUATION BENCHMARK</span>
          </div>
          <h1 className="page-title">Research Benchmarks & Algorithm Suite</h1>
          <p className="page-subtitle">
            Explore approved open-access reference datasets with full provenance and compare deterministic ISO thresholds with unsupervised ML methods.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            variant={activeTab === 'catalog' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('catalog')}
          >
            📚 Reference Datasets Catalog ({catalog.length})
          </Button>
          <Button
            variant={activeTab === 'algorithms' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('algorithms')}
          >
            🔬 Method Comparison Suite
          </Button>
        </div>
      </div>

      {activeTab === 'catalog' ? (
        /* Reference Dataset Catalog View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <AlertCallout
            severity="info"
            title="Public Research & Benchmark Datasets Policy"
            description="Reference datasets are registered with official citations, license terms, and component operating conditions. Users download datasets from official repositories and ingest with verified provenance. Arbitrary URLs are never fetched server-side."
          />

          {loadingCatalog ? (
            <p className="text-muted">Loading reference datasets catalog...</p>
          ) : errorCatalog ? (
            <AlertCallout severity="critical" title="Catalog Error" description={errorCatalog} />
          ) : catalog.length === 0 ? (
            <Card title="No Reference Datasets">
              <p className="text-muted">No reference benchmarks registered yet.</p>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {catalog.map((item) => {
                const details = item.referenceDetails || {};
                const compat = item.aiTaskCompatibility || {};

                return (
                  <Card
                    key={item._id}
                    title={item.title}
                    subtitle={item.description}
                    badge={
                      <span className="badge badge-site" style={{ textTransform: 'uppercase' }}>
                        {item.modality}
                      </span>
                    }
                  >
                    {/* Provenance & Citation Metadata Box */}
                    <div
                      style={{
                        background: 'var(--bg-surface-subtle)',
                        padding: '1rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                        marginBottom: '1rem'
                      }}
                    >
                      <div className="grid-two-col" style={{ gap: '0.75rem', fontSize: '0.875rem' }}>
                        <div>
                          <span className="text-muted">Source Repository:</span>{' '}
                          <strong>{details.sourceName || 'Open Research Archive'}</strong>
                        </div>
                        <div>
                          <span className="text-muted">License / Terms:</span>{' '}
                          <span className="mono-code">{details.license || 'Open Access'}</span>
                        </div>
                        <div>
                          <span className="text-muted">Component / Rig Type:</span>{' '}
                          <span>{details.machineType || 'Mechanical Testbed'}</span>
                        </div>
                        <div>
                          <span className="text-muted">Official Source Reference:</span>{' '}
                          {details.sourceUrl ? (
                            <a
                              href={details.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: 'var(--text-accent)', textDecoration: 'none' }}
                            >
                              Official Web Page ↗
                            </a>
                          ) : (
                            <span className="text-muted">Not specified</span>
                          )}
                        </div>
                      </div>

                      {details.citation && (
                        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                          <span className="text-muted text-sm" style={{ fontWeight: 600 }}>Formal Citation:</span>
                          <p className="text-sm mono-code" style={{ color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            &ldquo;{details.citation}&rdquo;
                          </p>
                        </div>
                      )}

                      {details.operatingConditions && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                          <span className="text-muted">Operating Conditions:</span> {details.operatingConditions}
                        </div>
                      )}

                      {details.knownLimitations && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--status-warning)' }}>
                          <strong>Known Limitations:</strong> {details.knownLimitations}
                        </div>
                      )}
                    </div>

                    {/* Sensor Channels & Observations Summary */}
                    <div className="metrics-grid" style={{ marginBottom: '1rem' }}>
                      <div className="metric-box">
                        <span className="metric-box-label">Recorded Rows</span>
                        <span className="metric-box-val">{item.totalRows?.toLocaleString()}</span>
                        <span className="metric-box-sub">{item.totalColumns} channels</span>
                      </div>
                      <div className="metric-box">
                        <span className="metric-box-label">Sampling Rate</span>
                        <span className="metric-box-val">
                          {item.samplingRateHz ? `${item.samplingRateHz} Hz` : 'Discrete Snapshots'}
                        </span>
                        <span className="metric-box-sub">
                          {item.timeRange?.durationSeconds
                            ? `${Math.round(item.timeRange.durationSeconds / 3600)}h span`
                            : 'Static records'}
                        </span>
                      </div>
                      <div className="metric-box">
                        <span className="metric-box-label">Validation Status</span>
                        <span className="metric-box-val" style={{ textTransform: 'uppercase', fontSize: '1.1rem' }}>
                          {item.status}
                        </span>
                        <span className="metric-box-sub">Schema v{item.dataSchemaVersion}</span>
                      </div>
                    </div>

                    {/* AI Task Compatibility Matrix */}
                    <div style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
                      <span className="text-sm text-muted" style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
                        Machine Learning Task Compatibility:
                      </span>
                      <div className="grid-two-col" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                        <div style={{ padding: '0.75rem', background: 'var(--bg-surface-elevated)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Anomaly Detection</span>
                            <StatusBadge
                              status={compat[AI_TASK_TYPES.ANOMALY_DETECTION]?.isCompatible ? 'healthy' : 'critical'}
                              label={compat[AI_TASK_TYPES.ANOMALY_DETECTION]?.isCompatible ? 'YES' : 'NO'}
                            />
                          </div>
                          <p className="text-secondary" style={{ fontSize: '0.75rem' }}>
                            {compat[AI_TASK_TYPES.ANOMALY_DETECTION]?.reason}
                          </p>
                        </div>

                        <div style={{ padding: '0.75rem', background: 'var(--bg-surface-elevated)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Fault Classification</span>
                            <StatusBadge
                              status={compat[AI_TASK_TYPES.FAULT_CLASSIFICATION]?.isCompatible ? 'healthy' : 'critical'}
                              label={compat[AI_TASK_TYPES.FAULT_CLASSIFICATION]?.isCompatible ? 'YES' : 'NO'}
                            />
                          </div>
                          <p className="text-secondary" style={{ fontSize: '0.75rem' }}>
                            {compat[AI_TASK_TYPES.FAULT_CLASSIFICATION]?.reason}
                          </p>
                        </div>

                        <div style={{ padding: '0.75rem', background: 'var(--bg-surface-elevated)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Remaining Useful Life</span>
                            <StatusBadge
                              status={compat[AI_TASK_TYPES.REMAINING_USEFUL_LIFE]?.isCompatible ? 'healthy' : 'critical'}
                              label={compat[AI_TASK_TYPES.REMAINING_USEFUL_LIFE]?.isCompatible ? 'YES' : 'NO'}
                            />
                          </div>
                          <p className="text-secondary" style={{ fontSize: '0.75rem' }}>
                            {compat[AI_TASK_TYPES.REMAINING_USEFUL_LIFE]?.reason}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <a
                        href={`${API_BASE}/datasets/${item._id}/download`}
                        download
                        className="btn btn-secondary btn-sm"
                        style={{ textDecoration: 'none' }}
                      >
                        ⬇ Download Dataset CSV ({((item.fileSizeBytes || 0) / 1024).toFixed(1)} KB)
                      </a>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Method Comparison Suite View */
        <>
          {/* Research Principles Notice */}
          <AlertCallout
            severity="info"
            title="Research Evaluation Protocol"
            description="Algorithms are evaluated across identical operating regimes (speed & load clusters). Supervised classifiers are restricted to verified ground-truth laboratory datasets. Anomaly scores are never equated with physical component failure without verified multi-channel corroboration."
            isSimulated={true}
          />

          {/* Evaluated Benchmark Models (Phase 6) */}
          {benchmarkModels.length > 0 && (
            <Card
              title="Evaluated Benchmark ML Models (Phase 6)"
              subtitle="Production models trained on gold-standard public & operational datasets with verified TreeSHAP additivity"
              badge={<span className="badge badge-demo">VERIFIED METRICS</span>}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
                {benchmarkModels.map((bm) => (
                  <div
                    key={bm._id || bm.id}
                    style={{
                      padding: '1rem',
                      borderRadius: '8px',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '0.75rem'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase' }}>
                          {bm.targetDomain?.replace('_', ' ') || 'General Domain'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: bm.status === 'ready' ? '#34d399' : '#f59e0b', fontWeight: 600 }}>
                          ● {bm.status?.toUpperCase()}
                        </span>
                      </div>
                      <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f8fafc', fontWeight: 600 }}>{bm.name}</h4>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                        Architecture: {bm.modelType === 'random_forest' ? 'Random Forest Multi-Class' : 'Isolation Forest Anomaly Detector'}
                      </p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: '#1e293b', padding: '0.5rem', borderRadius: '6px', fontSize: '0.8rem' }}>
                      {bm.modelType === 'random_forest' ? (
                        <>
                          <div>Accuracy: <strong style={{ color: '#38bdf8' }}>{bm.metrics?.accuracy ? `${(bm.metrics.accuracy * 100).toFixed(1)}%` : 'N/A'}</strong></div>
                          <div>Macro-F1: <strong style={{ color: '#34d399' }}>{bm.metrics?.macroF1 ? bm.metrics.macroF1.toFixed(3) : 'N/A'}</strong></div>
                        </>
                      ) : (
                        <>
                          <div>ROC-AUC: <strong style={{ color: '#38bdf8' }}>{bm.metrics?.rocAuc ? bm.metrics.rocAuc.toFixed(3) : 'N/A'}</strong></div>
                          <div>Threshold: <strong style={{ color: '#f59e0b' }}>{bm.metrics?.calibratedThreshold ? bm.metrics.calibratedThreshold.toFixed(3) : 'N/A'}</strong></div>
                        </>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>
                        {bm.shapSummary?.additivityVerified ? '✓ TreeSHAP Additivity Verified' : 'Attribution Evaluated'}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate('/analysis')}
                      >
                        Inspect SHAP →
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Algorithm Comparison Table */}
          <Card
            title="Method Comparison Matrix"
            subtitle="Evaluation criteria applied to identical mechanical gearbox test sequences"
            badge={<StatusBadge status="info" label="Comparative Benchmark" isSimulated={true} />}
          >
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Analysis Method</th>
                    <th scope="col">Category</th>
                    <th scope="col">Data Requirement</th>
                    <th scope="col">Lead Time</th>
                    <th scope="col">False Alarm Susceptibility</th>
                    <th scope="col">Explainability Mechanism</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="table-primary-text">ISO 10816 Thresholds</td>
                    <td>Deterministic Engineering</td>
                    <td>Unlabeled (None needed)</td>
                    <td>Low (Late stage)</td>
                    <td>Low in steady state; high during speed transients</td>
                    <td>Direct sensor amplitude vs standard Zone A/B/C bounds</td>
                  </tr>
                  <tr>
                    <td className="table-primary-text">Statistical Rolling Baseline</td>
                    <td>Statistical (Z-score, StdDev)</td>
                    <td>Historical baseline window</td>
                    <td>Medium</td>
                    <td>Moderate without regime clustering</td>
                    <td>Standard deviations from rolling mean per channel</td>
                  </tr>
                  <tr>
                    <td className="table-primary-text">Isolation Forest</td>
                    <td>Unsupervised Anomaly ML</td>
                    <td>Unlabeled operational data</td>
                    <td>High (Early deviation)</td>
                    <td>Low when regime-normalized; sensitive to sensor noise</td>
                    <td>Path length attribution / sensor contribution breakdown</td>
                  </tr>
                  <tr>
                    <td className="table-primary-text">Supervised Fault Classifier</td>
                    <td>Multi-Class Classification</td>
                    <td>Ground-truth labeled run-to-failure</td>
                    <td>High (Specific defect)</td>
                    <td>Dependent on training distribution match</td>
                    <td>SHAP feature importance (only on validated models)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Interactive Model Sensitivity Explorer */}
          <Card
            title="Model Sensitivity Exploration (Simulated What-If)"
            subtitle="Observe how the model anomaly score responds as an influential transducer approaches nominal baseline"
            badge={<span className="badge badge-demo">SENSITIVITY MODEL</span>}
          >
            <div className="sensitivity-container">
              <p className="text-secondary text-sm">
                <strong>Methodology Note:</strong> This exploration displays mathematical model sensitivity. It illustrates how the model score reduces as sensor readings converge toward baseline; it is labeled as model sensitivity, not physical causality or guaranteed repair outcome.
              </p>

              <div className="slider-control-group">
                <div className="slider-label-row">
                  <label htmlFor="vib-slider" className="form-label">
                    Simulated Pinion Radial Vibration: <strong>{pinionVib} mm/s</strong>
                  </label>
                  <span className="mono-code text-muted">Nominal Baseline: 2.8 mm/s</span>
                </div>
                <input
                  id="vib-slider"
                  type="range"
                  min="2.0"
                  max="6.0"
                  step="0.1"
                  value={pinionVib}
                  onChange={(e) => setPinionVib(parseFloat(e.target.value))}
                  className="range-slider"
                />
              </div>

              <div className="metrics-grid" style={{ marginTop: '1rem' }}>
                <MetricSummary
                  label="Simulated Anomaly Score"
                  value={simulatedScore}
                  status={isAnomaly ? 'warning' : 'healthy'}
                  sublabel={isAnomaly ? 'Exceeds Anomaly Cutoff (0.450)' : 'Within Nominal Cluster (< 0.450)'}
                  isSimulated={true}
                />
                <MetricSummary
                  label="Classification"
                  value={isAnomaly ? 'Unusual Behavior' : 'Nominal Cluster'}
                  status={isAnomaly ? 'warning' : 'healthy'}
                  sublabel="Statistical deviation, not verified failure"
                  isSimulated={true}
                />
                <MetricSummary
                  label="Sensitivity Derivative (∂S/∂v)"
                  value="0.280"
                  unit="score / (mm/s)"
                  status="info"
                  sublabel="Local model gradient at current point"
                  isSimulated={true}
                />
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
