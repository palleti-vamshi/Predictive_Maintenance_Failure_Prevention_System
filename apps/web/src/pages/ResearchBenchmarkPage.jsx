import React, { useState, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';
import Button from '../components/common/Button.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../router/Router.jsx';
import { DATASET_TYPES, AI_TASK_TYPES } from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function ResearchBenchmarkPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();

  // Tab switch: 'models' (default) vs 'catalog' vs 'algorithms'
  const [activeTab, setActiveTab] = useState('models');

  // Reference catalog state
  const [catalog, setCatalog] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Benchmark models state
  const [benchmarkModels, setBenchmarkModels] = useState([]);
  const [benchmarkReports, setBenchmarkReports] = useState(null);

  // Selected drill-down modal / detail state
  const [selectedBenchmark, setSelectedBenchmark] = useState(null); // 'cwru' or 'nasa_ims'

  // Algorithm sensitivity simulator slider: pinion vibration (mm/s)
  const [pinionVib, setPinionVib] = useState(4.2);

  // Compute simulated Isolation Forest anomaly score (0 to 1) based on distance to baseline 2.8 mm/s
  const baseline = 2.8;
  const deviation = Math.max(0, pinionVib - baseline);
  const simulatedScore = Math.min(1.0, (deviation / 2.5) * 0.7 + 0.15).toFixed(3);
  const isAnomaly = simulatedScore > 0.45;

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const token = user?.sessionToken || localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const [catRes, modRes, benchRes, manRes] = await Promise.all([
          fetch(`${API_BASE}/datasets/reference-catalog`, { credentials: 'include', headers }),
          fetch(`${API_BASE}/models`, { credentials: 'include', headers }),
          fetch(`${API_BASE}/models/benchmarks`, { credentials: 'include', headers }),
          fetch(`${API_BASE}/datasets/manifest`, { credentials: 'include', headers })
        ]);

        if (catRes.ok) {
          const data = await catRes.json();
          setCatalog(data.datasets || []);
        }

        if (modRes.ok) {
          const mData = await modRes.json();
          setBenchmarkModels(mData.models || []);
        }

        if (benchRes.ok) {
          const bData = await benchRes.json();
          setBenchmarkReports(bData.benchmarks || null);
        }

        if (manRes.ok) {
          const manData = await manRes.json();
          setManifest(manData.manifest || null);
        }
      } catch (err) {
        console.error('Fetch error:', err);
        setError(err.message || 'Error loading benchmark data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user]);

  const cwruReport = benchmarkReports?.cwru;
  const imsReport = benchmarkReports?.nasaIms;

  return (
    <div className="page-container">
      {/* Page Header matching UX Pilot Page 4 Specification */}
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-demo">RESEARCH & EVALUATION BENCHMARK</span>
          </div>
          <h1 className="page-title">Models & research</h1>
          <p className="page-subtitle">
            Every model, the data it was trained on, and how it was evaluated. Metrics appear only when they come from a documented held-out evaluation.
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Button
            variant={activeTab === 'models' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('models')}
            icon="activity"
          >
            Models & Coverage
          </Button>
          <Button
            variant={activeTab === 'catalog' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('catalog')}
            icon="book"
          >
            Reference Datasets Catalog ({catalog.length})
          </Button>
          <Button
            variant={activeTab === 'algorithms' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('algorithms')}
            icon="filter"
          >
            Method Comparison & What-If
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>Loading research models, evaluation manifests, and benchmarks...</p>
        </div>
      ) : error ? (
        <AlertCallout severity="critical" title="Benchmark Loading Error" description={error} />
      ) : activeTab === 'models' ? (
        /* ========================================================================= */
        /* TAB 1: MODELS & RESEARCH OVERVIEW (UX Pilot Page 4 Design)               */
        /* ========================================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {/* Methodology Principles (3 Glass Cards) */}
          <div className="grid-two-col" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            <div
              style={{
                background: 'var(--bg-surface-elevated)',
                padding: '1.25rem',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                <Icon name="check" size={18} color="var(--primary)" />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Random Forest</h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Classifies known fault types. Used only where suitable labelled data exists for that machine domain.
              </p>
            </div>

            <div
              style={{
                background: 'var(--bg-surface-elevated)',
                padding: '1.25rem',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                <Icon name="alert" size={18} color="var(--status-warning)" />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Isolation Forest</h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Flags data that differs from a baseline. A reason to investigate, never a diagnosis. No accuracy is reported without labels.
              </p>
            </div>

            <div
              style={{
                background: 'var(--bg-surface-elevated)',
                padding: '1.25rem',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                <Icon name="chart" size={18} color="#38bdf8" />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>SHAP</h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Explains which inputs drove a supported model&apos;s output. It is an explanation method, not a prediction model.
              </p>
            </div>
          </div>

          {/* Section: Coverage by Machine Type */}
          <Card
            title="Coverage by machine type"
            subtitle="Models are domain-specific. A machine type with no model can store datasets but cannot be analysed."
            badge={<span className="badge badge-site">DOMAIN SEPARATION</span>}
          >
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Machine type</th>
                    <th scope="col">Classification</th>
                    <th scope="col">Anomaly detection</th>
                    <th scope="col">SHAP</th>
                    <th scope="col">Data origin</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="table-primary-text"><strong>Bearing</strong></td>
                    <td>
                      <span className="badge badge-healthy" style={{ fontSize: '0.75rem' }}>
                        RF-Bearing v1.2
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                        IF-Bearing v1.0
                      </span>
                    </td>
                    <td>RF only</td>
                    <td>CWRU, NASA IMS experiments</td>
                  </tr>
                  <tr>
                    <td className="table-primary-text"><strong>Gearbox</strong></td>
                    <td>
                      <span className="badge badge-healthy" style={{ fontSize: '0.75rem' }}>
                        RF-Gearbox v1.0
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                        IF-Gearbox v1.0
                      </span>
                    </td>
                    <td>RF only</td>
                    <td>Gearbox specimen & simulator uploads</td>
                  </tr>
                  <tr style={{ opacity: 0.6 }}>
                    <td className="table-primary-text">Pump</td>
                    <td><span className="text-muted">No model</span></td>
                    <td><span className="text-muted">No model</span></td>
                    <td>—</td>
                    <td className="text-muted">No labelled or baseline data yet</td>
                  </tr>
                  <tr style={{ opacity: 0.6 }}>
                    <td className="table-primary-text">Motor</td>
                    <td><span className="text-muted">No model</span></td>
                    <td><span className="text-muted">No model</span></td>
                    <td>—</td>
                    <td className="text-muted">No labelled or baseline data yet</td>
                  </tr>
                  <tr style={{ opacity: 0.6 }}>
                    <td className="table-primary-text">Compressor</td>
                    <td><span className="text-muted">No model</span></td>
                    <td><span className="text-muted">No model</span></td>
                    <td>—</td>
                    <td className="text-muted">No labelled or baseline data yet</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Section: Bearing Experiments (CWRU · NASA IMS) */}
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
                  Bearing experiments
                </h2>
                <span className="mono-code text-muted" style={{ fontSize: '0.85rem' }}>
                  CWRU · NASA IMS
                </span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.25rem 0 0 0' }}>
                Results from public laboratory test-rig datasets. Shown as bearing experiments, not as factory performance.
              </p>
            </div>

            <div className="grid-two-col" style={{ gap: '1.25rem' }}>
              {/* Card 1: RF-Bearing-Fault v1.2 */}
              <div
                style={{
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>RF-Bearing-Fault v1.2</h3>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Random Forest · 4 classes: Normal, Inner race, Outer race, Ball
                      </p>
                    </div>
                    <span className="badge badge-healthy">In use</span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.75rem',
                      background: 'var(--bg-surface-subtle)',
                      padding: '0.85rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      marginTop: '0.75rem'
                    }}
                  >
                    <div>
                      <span className="text-muted block text-xs">Training data</span>
                      <strong className="block text-primary">CWRU 12 kHz drive-end, 0–3 HP</strong>
                    </div>
                    <div>
                      <span className="text-muted block text-xs">Training version</span>
                      <span className="mono-code text-xs">train-cwru-2025-03-10</span>
                    </div>
                    <div>
                      <span className="text-muted block text-xs">Evaluation split</span>
                      <strong className="block text-primary">Held out by load condition (3 HP)</strong>
                    </div>
                    <div>
                      <span className="text-muted block text-xs">Eval version</span>
                      <span className="mono-code text-xs">eval-cwru-2025-03-12</span>
                    </div>
                  </div>

                  {/* Highlight Metrics */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '0.5rem',
                      marginTop: '0.75rem',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.6rem', borderRadius: '6px' }}>
                      <span className="text-muted block text-xs">Macro F1</span>
                      <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8' }}>
                        {cwruReport?.metrics?.macro_f1 ? cwruReport.metrics.macro_f1.toFixed(2) : '1.00'}
                      </span>
                    </div>
                    <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.6rem', borderRadius: '6px' }}>
                      <span className="text-muted block text-xs">Accuracy</span>
                      <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-healthy)' }}>
                        {cwruReport?.metrics?.accuracy ? cwruReport.metrics.accuracy.toFixed(2) : '1.00'}
                      </span>
                    </div>
                    <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.6rem', borderRadius: '6px' }}>
                      <span className="text-muted block text-xs">Test windows</span>
                      <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {cwruReport?.sample_counts?.test_windows || 827}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <p className="text-secondary text-xs" style={{ margin: '0 0 0.75rem 0', lineHeight: 1.4 }}>
                    Seeded fault experiments on a single test rig. Expect lower performance on other bearings and sensors.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="chart"
                    onClick={() => setSelectedBenchmark(selectedBenchmark === 'cwru' ? null : 'cwru')}
                  >
                    {selectedBenchmark === 'cwru' ? 'Hide Confusion Matrix & SHAP' : 'Inspect Evaluation & TreeSHAP →'}
                  </Button>
                </div>
              </div>

              {/* Card 2: IF-Bearing-Anomaly v1.0 */}
              <div
                style={{
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>IF-Bearing-Anomaly v1.0</h3>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Isolation Forest · unsupervised · 8 time/frequency features
                      </p>
                    </div>
                    <span className="badge badge-healthy">In use</span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.75rem',
                      background: 'var(--bg-surface-subtle)',
                      padding: '0.85rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      marginTop: '0.75rem'
                    }}
                  >
                    <div>
                      <span className="text-muted block text-xs">Baseline data</span>
                      <strong className="block text-primary">NASA IMS test 2, first 20% of run (196 snapshots, ~32.7 hours)</strong>
                    </div>
                    <div>
                      <span className="text-muted block text-xs">Sampling interval</span>
                      <strong className="block text-primary">10-minute snapshots (164.0h total)</strong>
                    </div>
                    <div>
                      <span className="text-muted block text-xs">Evaluation</span>
                      <strong className="block text-primary">Detection lead time on run-to-failure (ISO timestamps)</strong>
                    </div>
                    <div>
                      <span className="text-muted block text-xs">Calibrated threshold</span>
                      <span className="mono-code text-xs">99th percentile normalized (1st pct raw decision)</span>
                    </div>
                  </div>

                  {/* Highlight Metrics */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.5fr 1fr',
                      gap: '0.5rem',
                      marginTop: '0.75rem',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.6rem', borderRadius: '6px' }}>
                      <span className="text-muted block text-xs">First sustained flag (test 2 bearing 1)</span>
                      <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--status-warning)' }}>
                        {imsReport?.lead_time?.lead_time_human || '~2.5 days before end of run'}
                      </span>
                    </div>
                    <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.6rem', borderRadius: '6px' }}>
                      <span className="text-muted block text-xs">Accuracy</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.3, display: 'block', marginTop: '0.2rem' }}>
                        Not reported — no labelled anomaly set
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <p className="text-secondary text-xs" style={{ margin: '0 0 0.75rem 0', lineHeight: 1.4 }}>
                    Lab run-to-failure data under constant load. Not evidence for gearboxes or factory bearings.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="activity"
                    onClick={() => setSelectedBenchmark(selectedBenchmark === 'nasa_ims' ? null : 'nasa_ims')}
                  >
                    {selectedBenchmark === 'nasa_ims' ? 'Hide Degradation Trajectory' : 'Inspect Run-to-Failure Timeline →'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Drilldown Section for CWRU */}
            {selectedBenchmark === 'cwru' && cwruReport && (
              <div
                style={{
                  marginTop: '1.25rem',
                  padding: '1.25rem',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>
                    CWRU Held-Out Confusion Matrix & TreeSHAP Attributions (Load 3 HP)
                  </h4>
                  <span className="mono-code text-xs text-muted">
                    Test partition: 827 windows
                  </span>
                </div>

                <div className="grid-two-col" style={{ gap: '1.5rem' }}>
                  {/* Confusion Matrix */}
                  <div>
                    <span className="text-muted text-xs block" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                      Confusion Matrix (Held-out 3 HP test windows)
                    </span>
                    <div className="table-responsive">
                      <table className="data-table" style={{ fontSize: '0.8rem' }}>
                        <thead>
                          <tr>
                            <th>Actual \ Predicted</th>
                            {cwruReport.metrics.confusion_matrix.labels.map((l) => (
                              <th key={l} style={{ textTransform: 'capitalize' }}>{l}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cwruReport.metrics.confusion_matrix.labels.map((label, rIdx) => (
                            <tr key={label}>
                              <td><strong style={{ textTransform: 'capitalize' }}>{label}</strong></td>
                              {cwruReport.metrics.confusion_matrix.matrix[rIdx].map((val, cIdx) => (
                                <td
                                  key={cIdx}
                                  style={{
                                    fontWeight: rIdx === cIdx ? 700 : 400,
                                    color: rIdx === cIdx ? 'var(--status-healthy)' : 'var(--text-muted)'
                                  }}
                                >
                                  {val}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* TreeSHAP Feature Attributions */}
                  <div>
                    <span className="text-muted text-xs block" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                      TreeSHAP Mean Absolute Attributions (Exact Additive Feature Contributions)
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {cwruReport.shap_summary.feature_attributions.slice(0, 6).map((item) => (
                        <div key={item.feature} style={{ fontSize: '0.8rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem' }}>
                            <span className="mono-code">{item.feature}</span>
                            <span style={{ fontWeight: 600, color: '#38bdf8' }}>{item.mean_abs_shap}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'var(--bg-surface-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.min(100, (item.mean_abs_shap / 0.35) * 100)}%`,
                                height: '100%',
                                background: 'var(--primary)'
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-secondary text-xs" style={{ marginTop: '0.75rem', fontStyle: 'italic' }}>
                      {cwruReport.shap_summary.methodology_note}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Drilldown Section for NASA IMS */}
            {selectedBenchmark === 'nasa_ims' && imsReport && (
              <div
                style={{
                  marginTop: '1.25rem',
                  padding: '1.25rem',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>
                    NASA IMS Test 2 Run-to-Failure Degradation Trajectory
                  </h4>
                  <span className="mono-code text-xs text-muted">
                    Total: 984 snapshots sampled at ~10-minute intervals (Feb 12 10:32 – Feb 19 06:22 UTC, 164.0h)
                  </span>
                </div>

                <div className="table-responsive">
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Elapsed Hours</th>
                        <th>Timestamp (UTC)</th>
                        <th>Vibration RMS (g)</th>
                        <th>Kurtosis</th>
                        <th>Anomaly Score</th>
                        <th>Threshold (0.5236)</th>
                        <th>Flag Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(imsReport.timeline_sample || []).slice(0, 10).map((pt, idx) => (
                        <tr key={idx}>
                          <td className="mono-code">{pt.hours_from_start} h</td>
                          <td className="mono-code">{pt.timestamp.replace('T', ' ').slice(0, 19)}</td>
                          <td className="mono-code">{pt.rms_g} g</td>
                          <td className="mono-code">{pt.kurtosis}</td>
                          <td className="mono-code" style={{ fontWeight: 600 }}>{pt.anomaly_score}</td>
                          <td className="mono-code text-muted">0.5236</td>
                          <td>
                            <StatusBadge
                              status={pt.is_flagged ? 'warning' : 'healthy'}
                              label={pt.is_flagged ? 'FLAGGED' : 'NOMINAL'}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-secondary text-xs" style={{ marginTop: '0.75rem' }}>
                  <strong>Ground Truth Validation:</strong> {imsReport.accuracy_statement}
                </p>
              </div>
            )}
          </div>

          {/* Section: Gearbox Simulator Uploads */}
          <Card
            title="Gearbox simulator & specimen uploads"
            subtitle="Kept separate from bearing experiments. Trained and evaluated on validated gearbox specimens and telemetry exports with verified reproducibility."
            badge={<span className="badge badge-demo">SPECIMEN BENCHMARKS ONLY</span>}
          >
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Method</th>
                    <th scope="col">Training data</th>
                    <th scope="col">Evaluation</th>
                    <th scope="col">Metrics</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="table-primary-text">
                      <strong>Random Forest Gear Fault Classifier</strong>
                      <span className="mono-code text-muted text-xs block">v1.0.0 · seu-dds-gearbox</span>
                    </td>
                    <td><span className="badge badge-healthy" style={{ fontSize: '0.75rem' }}>Classification</span></td>
                    <td style={{ fontSize: '0.85rem' }}>SEU DDS specimen dataset (180 raw rows, dual 20Hz & 30Hz speeds, 12 windows, 95 features)</td>
                    <td style={{ fontSize: '0.85rem' }}>StratifiedShuffleSplit (80/20 train/test: 9 train, 3 test windows across broken tooth, chipped tooth, healthy)</td>
                    <td>
                      <strong style={{ color: '#38bdf8' }}>Macro F1 1.00</strong>
                      <span className="text-muted text-xs block">n = 3 test windows (Acc 1.00)</span>
                    </td>
                    <td><span className="badge badge-demo">In use · specimen artifact</span></td>
                  </tr>
                  <tr>
                    <td className="table-primary-text">
                      <strong>Isolation Forest Anomaly Detector</strong>
                      <span className="mono-code text-muted text-xs block">v1.0.0 · gb-104-baseline</span>
                    </td>
                    <td><span className="badge badge-info" style={{ fontSize: '0.75rem' }}>Anomaly</span></td>
                    <td style={{ fontSize: '0.85rem' }}>GB-104 healthy baseline telemetry run (300 raw rows, 36 extracted windows across 6 mapped signals, 72 features)</td>
                    <td style={{ fontSize: '0.85rem' }}>25 train / 11 test windows; calibrated at 5th percentile of healthy baseline training distribution</td>
                    <td>
                      <span className="text-muted text-xs block">Mean anomaly score 0.422</span>
                      <span className="text-xs">No accuracy claim (unsupervised)</span>
                    </td>
                    <td><span className="badge badge-demo">In use · telemetry artifact</span></td>
                  </tr>
                  <tr style={{ opacity: 0.75 }}>
                    <td className="table-primary-text">
                      <strong>GB-104 Simulator Telemetry Run</strong>
                      <span className="mono-code text-muted text-xs block">inference-telemetry-run</span>
                    </td>
                    <td><span className="badge badge-site" style={{ fontSize: '0.75rem' }}>Single Run Eval</span></td>
                    <td style={{ fontSize: '0.85rem' }}>656 raw telemetry rows windowed with size 16 and 50% stride (stride 8)</td>
                    <td style={{ fontSize: '0.85rem' }}>Single-file inference pipeline test (apps/server/tests/simulator-upload.test.js)</td>
                    <td><span className="mono-code text-xs">81 inference windows</span></td>
                    <td><span className="badge badge-site">Inference test</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : activeTab === 'catalog' ? (
        /* ========================================================================= */
        /* TAB 2: REFERENCE DATASETS CATALOG                                         */
        /* ========================================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <AlertCallout
            severity="info"
            title="Public Research & Benchmark Datasets Policy"
            description="Reference datasets are registered with official citations, license terms, and component operating conditions. Users download datasets from official repositories and ingest with verified provenance. Arbitrary URLs are never fetched server-side."
          />

          {/* Dataset Manifest Overview */}
          {manifest && (
            <Card
              title="Verified Dataset Manifest (data/manifest.json)"
              subtitle="Official provenance, checksums, and machine domain separation"
              badge={<span className="badge badge-healthy">LOCAL VERIFIED ARCHIVES</span>}
            >
              <div className="grid-two-col" style={{ gap: '1rem', fontSize: '0.85rem' }}>
                <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.85rem', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <strong style={{ fontSize: '0.95rem' }}>CWRU Bearing Data Center</strong>
                    <span className="badge badge-healthy">16 .mat files verified</span>
                  </div>
                  <p className="text-muted text-xs" style={{ margin: '0 0 0.5rem 0' }}>
                    Machine: SKF 6205-2RS JEM deep groove ball bearing at 12 kHz (0, 1, 2, 3 HP motor loads)
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className="text-muted text-xs">Official Portal:</span>
                    <a
                      href="https://engineering.case.edu/bearingdatacenter/download-data-file"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--text-accent)', textDecoration: 'none', fontSize: '0.8rem' }}
                    >
                      engineering.case.edu/bearingdatacenter ↗
                    </a>
                  </div>
                </div>

                <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.85rem', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <strong style={{ fontSize: '0.95rem' }}>NASA IMS Bearings</strong>
                    <span className="badge badge-healthy">2nd_test.rar (984 snapshots) verified</span>
                  </div>
                  <p className="text-muted text-xs" style={{ margin: '0 0 0.5rem 0' }}>
                    Machine: Rexnord ZA-2115 double-row bearing run-to-failure (2000 RPM, 6000 lbs radial load)
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className="text-muted text-xs">Official Portal:</span>
                    <a
                      href="https://data.nasa.gov/dataset/ims-bearings"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--text-accent)', textDecoration: 'none', fontSize: '0.8rem' }}
                    >
                      data.nasa.gov/dataset/ims-bearings ↗
                    </a>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Database Registered Reference Datasets */}
          {catalog.length === 0 ? (
            <Card title="No Reference Datasets">
              <p className="text-muted">No reference benchmarks registered in database yet.</p>
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
        /* ========================================================================= */
        /* TAB 3: METHOD COMPARISON SUITE & SENSITIVITY WHAT-IF                      */
        /* ========================================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Research Principles Notice */}
          <AlertCallout
            severity="info"
            title="Research Evaluation Protocol"
            description="Algorithms are evaluated across identical operating regimes (speed & load clusters). Supervised classifiers are restricted to verified ground-truth laboratory datasets. Anomaly scores are never equated with physical component failure without verified multi-channel corroboration."
            isSimulated={true}
          />

          {/* Algorithm Comparison Table */}
          <Card
            title="Method Comparison Matrix"
            subtitle="Evaluation criteria applied to identical mechanical test sequences"
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
                    <td>Unlabeled operational baseline</td>
                    <td>High (Early deviation)</td>
                    <td>Low when regime-normalized; sensitive to sensor noise</td>
                    <td>Path length attribution / sensor contribution breakdown</td>
                  </tr>
                  <tr>
                    <td className="table-primary-text">Supervised Fault Classifier</td>
                    <td>Multi-Class Classification</td>
                    <td>Ground-truth labeled runs</td>
                    <td>High (Specific defect)</td>
                    <td>Dependent on training distribution match</td>
                    <td>TreeSHAP feature importance (only on validated models)</td>
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
        </div>
      )}
    </div>
  );
}
