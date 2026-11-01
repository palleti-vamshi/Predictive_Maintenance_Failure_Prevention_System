import React, { useState, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import { DEMO_MACHINES, DEMO_ALERTS, DEMO_DATASETS, USER_ROLES } from '@predictive-maintenance/shared';
import { useRouter, ROUTES } from '../router/Router.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * MachineDetailPage: Server-authorized machine specification, stages, sensor topology, and maintenance notes.
 */
export default function MachineDetailPage() {
  const { params, navigate } = useRouter();
  const { user } = useAuth();
  const machineCode = params?.id || 'GB-104';

  const [machine, setMachine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('sensors');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('Field Inspection');
  const [noteSuccess, setNoteSuccess] = useState(null);
  const [noteError, setNoteError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchMachine() {
      setLoading(true);
      setErrorStatus(null);
      setErrorMessage(null);
      try {
        const res = await fetch(`${API_BASE}/machines/${machineCode}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });

        const data = await res.json();
        if (!res.ok) {
          if (isMounted) {
            setErrorStatus(res.status);
            setErrorMessage(data.message || `HTTP ${res.status}: Access Denied`);
          }
          return;
        }

        if (isMounted) {
          setMachine(data.machine);
        }
      } catch (err) {
        if (isMounted) {
          // Fallback to local demo specimen if offline
          const fallback = DEMO_MACHINES.find((m) => m.id === machineCode) || DEMO_MACHINES[0];
          setMachine(fallback);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchMachine();
    return () => {
      isMounted = false;
    };
  }, [machineCode]);

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteContent.trim()) return;

    setNoteSuccess(null);
    setNoteError(null);

    try {
      const res = await fetch(`${API_BASE}/machines/${machineCode}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          content: noteContent.trim(),
          category: noteCategory
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setNoteError(data.message || `Server rejected note: ${res.status}`);
        return;
      }

      setNoteSuccess('Maintenance note recorded in machine history.');
      setNoteContent('');
      if (machine) {
        setMachine({
          ...machine,
          notes: [data.note, ...(machine.notes || [])]
        });
      }
    } catch (err) {
      setNoteError(err.message || 'Network error recording maintenance note.');
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="text-secondary">Loading machine profile from factory database...</p>
      </div>
    );
  }

  // Handle server-enforced scoping errors (403 Forbidden or 404 Not Found)
  if (errorStatus) {
    return (
      <div className="page-container">
        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          <button className="breadcrumb-link" onClick={() => navigate(ROUTES.MACHINES)}>
            Machines
          </button>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{machineCode}</span>
        </nav>

        <Card
          title={errorStatus === 404 ? 'Machine Not Found in Factory Scope' : 'Access Denied to Machine'}
          badge={<StatusBadge status={errorStatus === 404 ? 'critical' : 'warning'} label={`HTTP ${errorStatus}`} />}
        >
          <AlertCallout
            severity={errorStatus === 404 ? 'critical' : 'warning'}
            title={errorStatus === 404 ? '404 Scoped Boundary Isolation' : '403 Unauthorized Equipment Assignment'}
            description={
              errorStatus === 404
                ? `Equipment "${machineCode}" does not exist within your factory scope (${user?.factoryId?.name || 'Factory'}). To prevent data leakage, cross-factory machine existence is never disclosed.`
                : `Your account (${user?.fullName}, ${user?.role}) is not assigned to equipment "${machineCode}". Access is denied by backend middleware.`
            }
            action={
              <Button variant="secondary" onClick={() => navigate(ROUTES.MACHINES)}>
                ← Return to Your Accessible Machines
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!machine) return null;

  const machineId = machine.code || machine.id;
  const machineAlert = DEMO_ALERTS.find((a) => a.machineId === machineId);
  const machineDatasets = DEMO_DATASETS.filter((d) => d.machineId === machineId);
  const stages = machine.stages || [];
  const signals = machine.monitoredSignals || [];
  const notes = machine.notes || [];

  return (
    <div className="page-container">
      {/* Breadcrumb Navigation */}
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <button className="breadcrumb-link" onClick={() => navigate(ROUTES.MACHINES)}>
          Machines
        </button>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{machineId} ({machine.name})</span>
      </nav>

      {/* Header Bar */}
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="mono-code" style={{ fontSize: '1rem' }}>{machineId}</span>
            <span className="badge badge-demo">AUTHORIZED ASSET</span>
            <StatusBadge status={machine.status} label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'} isSimulated={true} />
          </div>
          <h1 className="page-title">{machine.name}</h1>
          <p className="page-subtitle">
            {machine.manufacturer} • Model {machine.model} • {machine.siteId?.name || machine.site || 'Extrusion'}
          </p>
        </div>
        <div className="page-header-actions">
          <Button variant="primary" onClick={() => navigate(ROUTES.DATASETS_UPLOAD)} icon="⬆️">
            Upload Gearbox Dataset
          </Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.ANALYSIS)}>
            View Condition Trends →
          </Button>
        </div>
      </div>

      {/* Active Warning Callout if present */}
      {machineAlert && (
        <AlertCallout
          severity={machineAlert.severity}
          title={`Active Warning: ${machineAlert.title}`}
          description={machineAlert.description}
          timestamp={new Date(machineAlert.timestamp).toLocaleString()}
          contributingSignals={machineAlert.contributingSignals}
          isSimulated={true}
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate(ROUTES.ALERTS)}>
              Review Alert & Acknowledge →
            </Button>
          }
        />
      )}

      {/* Mechanical Stage Architecture Card */}
      {stages.length > 0 && (
        <Card
          title="Mechanical Stage Architecture"
          subtitle="Internal gear train stages, gear ratios, and component kinematics"
        >
          <div className="stages-diagram-grid">
            {stages.map((stg) => (
              <div key={stg.stage} className="stage-diagram-card">
                <div className="stage-header">
                  <span className="stage-index">Stage {stg.stage}</span>
                  <span className="stage-kind">{stg.type}</span>
                </div>
                <div className="stage-ratio-box">
                  <span className="ratio-label">Stage Ratio</span>
                  <span className="ratio-value">{stg.ratio}</span>
                </div>
                <div className="stage-condition-badge">
                  <span
                    className="badge-dot"
                    style={{
                      backgroundColor:
                        stg.condition?.includes('Elevated')
                          ? 'var(--status-warning)'
                          : 'var(--status-healthy)'
                    }}
                  />
                  <span>{stg.condition || 'Nominal [DEMO]'}</span>
                </div>
              </div>
            ))}
            <div className="stage-diagram-card overall-ratio-card">
              <div className="stage-header">
                <span className="stage-index">Total</span>
                <span className="stage-kind">Cumulative Kinematics</span>
              </div>
              <div className="stage-ratio-box">
                <span className="ratio-label">Overall Ratio</span>
                <span className="ratio-value">{machine.gearRatio || '14.2:1'}</span>
              </div>
              <div className="stage-condition-badge">
                <span>Rated: {machine.ratedSpeedRpm || 1780} RPM @ {machine.ratedTorqueNm || 480} Nm</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Detail Tabs */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'sensors' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('sensors')}
        >
          Sensor Channels ({signals.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'datasets' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('datasets')}
        >
          Historical Datasets ({machineDatasets.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'notes' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          Maintenance Notes ({notes.length})
        </button>
      </div>

      {activeTab === 'sensors' ? (
        <Card
          title="Decoupled Sensor Channel Topology"
          subtitle="Physical transducers mapped to vibration, thermal, and operating regime pipelines"
        >
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Signal Label</th>
                  <th scope="col">Category</th>
                  <th scope="col">Standard Unit</th>
                  <th scope="col">Transducer Channel Key</th>
                  <th scope="col">Analysis Pathway</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((sig) => (
                  <tr key={sig.key}>
                    <td className="table-primary-text">{sig.label}</td>
                    <td>
                      <span className={`category-tag category-${sig.category}`}>
                        {sig.category?.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className="mono-code">{sig.unit}</span>
                    </td>
                    <td>
                      <span className="mono-code text-muted">{sig.key}</span>
                    </td>
                    <td>
                      {sig.category === 'vibration'
                        ? 'ISO 10816 Velocity / High-Freq Acceleration'
                        : sig.category === 'thermal'
                        ? 'Bulk Sump / Localized Bearing Friction'
                        : 'Regime Clustering & Normalization'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : activeTab === 'datasets' ? (
        <Card
          title="Associated Ingestion Datasets"
          subtitle="Historical CSV files uploaded for condition monitoring analysis"
        >
          {machineDatasets.length > 0 ? (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Filename</th>
                    <th scope="col">Type</th>
                    <th scope="col">Upload Timestamp</th>
                    <th scope="col">Sampling Rate</th>
                    <th scope="col">Coverage</th>
                    <th scope="col">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {machineDatasets.map((ds) => (
                    <tr key={ds.id}>
                      <td className="mono-code table-primary-text">{ds.filename}</td>
                      <td>
                        <StatusBadge status="demo" label={ds.recordType} />
                      </td>
                      <td>{ds.uploadedAt}</td>
                      <td>{ds.samplingRateHz} Hz</td>
                      <td>{ds.coveragePct}% ({ds.rowCount?.toLocaleString()} rows)</td>
                      <td>{ds.fileSizeDisplay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-secondary">No datasets uploaded for this machine specimen yet.</p>
          )}
        </Card>
      ) : (
        <div className="grid-two-col">
          {/* Add note card */}
          <Card
            title="Log Machine Maintenance Note"
            subtitle="Server-enforced: Only Managers and assigned Technicians have write authorization"
          >
            {user?.role === USER_ROLES.VIEWER ? (
              <div className="login-error-alert" role="status">
                <span>👁️ Viewers have read-only access. You cannot submit maintenance notes.</span>
              </div>
            ) : (
              <form onSubmit={handleAddNote}>
                {noteSuccess && (
                  <div className="action-toast" style={{ marginBottom: '1rem' }} role="status">
                    ✓ {noteSuccess}
                  </div>
                )}
                {noteError && (
                  <div className="login-error-alert" style={{ marginBottom: '1rem' }} role="alert">
                    ⚠️ {noteError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="note-category">Category:</label>
                  <select
                    id="note-category"
                    className="form-select"
                    value={noteCategory}
                    onChange={(e) => setNoteCategory(e.target.value)}
                  >
                    <option value="Field Inspection">Field Inspection</option>
                    <option value="Lubrication">Lubrication & Oil Refill</option>
                    <option value="Sensor Calibration">Sensor Calibration</option>
                    <option value="Mechanical Adjustment">Mechanical Adjustment</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="note-body">Observations & Actions:</label>
                  <textarea
                    id="note-body"
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. Inspected pinion backlash, replenished 150ml synthetic gear oil..."
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    required
                  />
                </div>

                <Button type="submit" variant="primary" disabled={!noteContent.trim()}>
                  Submit Note to Server
                </Button>
              </form>
            )}
          </Card>

          {/* Notes list */}
          <Card title="Maintenance History" subtitle="Logged actions for this machine">
            {notes.length === 0 ? (
              <p className="text-secondary">No maintenance notes recorded yet.</p>
            ) : (
              <div className="notes-feed">
                {notes.map((n, idx) => (
                  <div key={idx} className="note-item">
                    <div className="note-header">
                      <span className="note-author">{n.author}</span>
                      <span className="note-time">{new Date(n.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="note-category-pill">{n.category}</div>
                    <p className="note-content">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
