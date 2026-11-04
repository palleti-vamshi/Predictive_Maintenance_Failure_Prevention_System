import React, { useState, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import LoadingSkeleton from '../components/common/LoadingSkeleton.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter, ROUTES } from '../router/Router.jsx';
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  USER_ROLES,
  WORK_ORDER_PRIORITY
} from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function AlertsPage() {
  const { user } = useAuth();
  const { queryParams, navigate } = useRouter();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;
  const isViewer = user?.role === USER_ROLES.VIEWER;

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [actionNotice, setActionNotice] = useState(null);

  // Field Observation state
  const [activeObservationAlertId, setActiveObservationAlertId] = useState(null);
  const [observationInput, setObservationInput] = useState('');
  const [isSubmittingObs, setIsSubmittingObs] = useState(false);

  // Create Work Order modal state
  const [workOrderModalAlert, setWorkOrderModalAlert] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [workOrderForm, setWorkOrderForm] = useState({
    title: '',
    description: '',
    priority: WORK_ORDER_PRIORITY.HIGH,
    dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
    assignedTechnicianId: ''
  });
  const [isCreatingWo, setIsCreatingWo] = useState(false);
  const [woError, setWoError] = useState(null);

  // Fetch live alerts
  const fetchAlerts = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const res = await fetch(`${API_BASE}/alerts`, {
        credentials: 'include',
        headers
      });

      if (!res.ok) {
        throw new Error('Failed to load condition alerts.');
      }

      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      console.error('Fetch alerts error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch technicians for work order modal
  const fetchTechnicians = async () => {
    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/admin/factory-users`, {
        credentials: 'include',
        headers
      });
      if (res.ok) {
        const data = await res.json();
        const techs = (data.users || []).filter((u) => u.role === USER_ROLES.TECHNICIAN);
        setTechnicians(techs);
        if (techs.length > 0 && !workOrderForm.assignedTechnicianId) {
          setWorkOrderForm((prev) => ({ ...prev, assignedTechnicianId: techs[0]._id }));
        }
      }
    } catch (err) {
      console.error('Failed to load technicians:', err);
    }
  };

  useEffect(() => {
    fetchAlerts();
    if (isManager) {
      fetchTechnicians();
    }
  }, [user]);

  useEffect(() => {
    if (queryParams?.severity) {
      setSeverityFilter(queryParams.severity);
    }
    if (queryParams?.status) {
      setStatusFilter(queryParams.status);
    }
  }, [queryParams]);

  // Acknowledge alert handler
  const handleAcknowledge = async (alertId) => {
    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        credentials: 'include',
        headers
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to acknowledge alert.');
      }

      const data = await res.json();
      setAlerts((prev) =>
        prev.map((a) => (a._id === alertId ? { ...a, status: ALERT_STATUSES.ACKNOWLEDGED, acknowledgedByName: user?.fullName } : a))
      );
      setActionNotice('Alert acknowledged successfully.');
      setTimeout(() => setActionNotice(null), 4000);
    } catch (err) {
      alert(err.message);
    }
  };

  // Submit Observation note handler
  const handleObservationSubmit = async (alertId) => {
    if (!observationInput.trim()) return;
    setIsSubmittingObs(true);
    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const res = await fetch(`${API_BASE}/alerts/${alertId}/observations`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ note: observationInput.trim() })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to record observation note.');
      }

      const data = await res.json();
      setAlerts((prev) =>
        prev.map((a) => (a._id === alertId ? data.alert : a))
      );
      setObservationInput('');
      setActiveObservationAlertId(null);
      setActionNotice('Technician field observation note logged.');
      setTimeout(() => setActionNotice(null), 4000);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsSubmittingObs(false);
    }
  };

  // Open Create Work Order Modal
  const openWorkOrderModal = (alert) => {
    setWorkOrderModalAlert(alert);
    setWoError(null);
    setWorkOrderForm({
      title: `Inspect ${alert.machineId?.code || 'Equipment'} — ${alert.title}`,
      description: `Follow up on condition alert (${alert._id}). ${alert.severityNote || 'Investigate elevated sensor deviation.'}`,
      priority: alert.severity === ALERT_SEVERITIES.CRITICAL ? WORK_ORDER_PRIORITY.HIGH : WORK_ORDER_PRIORITY.MEDIUM,
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      assignedTechnicianId: technicians[0]?._id || ''
    });
  };

  // Submit Work Order
  const handleCreateWorkOrder = async (e) => {
    e.preventDefault();
    if (!workOrderModalAlert) return;
    setIsCreatingWo(true);
    setWoError(null);

    try {
      const token = user?.sessionToken || localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const res = await fetch(`${API_BASE}/alerts/${workOrderModalAlert._id}/work-order`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(workOrderForm)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create maintenance work order.');
      }

      // Update alert in list with linked work order
      setAlerts((prev) =>
        prev.map((a) =>
          a._id === workOrderModalAlert._id
            ? { ...a, maintenanceWorkOrderId: data.workOrder }
            : a
        )
      );

      setWorkOrderModalAlert(null);
      setActionNotice(`Maintenance work order [${data.workOrder.orderNumber}] created successfully.`);
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err) {
      console.error('Work order creation error:', err);
      setWoError(err.message);
    } finally {
      setIsCreatingWo(false);
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (queryParams?.machineId) {
      const matchMach = (a.machineId?._id || a.machineId?.code || a.machineId)?.toString();
      if (matchMach !== queryParams.machineId.toString()) return false;
    }
    if (queryParams?.analysisRunId) {
      const matchRun = (a.analysisRunId?._id || a.analysisRunId)?.toString();
      if (matchRun !== queryParams.analysisRunId.toString()) return false;
    }
    return true;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="mono-code">ANOMALY SURVEILLANCE</span>
            <span className="badge badge-info">EVIDENCE-BASED ATTRIBUTION</span>
          </div>
          <h1 className="page-title">Condition Warnings & Actionable Alerts</h1>
          <p className="page-subtitle">
            Calibrated anomaly intervals, physical sensor deviations, verified TreeSHAP attributions, and maintenance workflows.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Button variant="secondary" onClick={fetchAlerts}>
            <Icon name="refresh" size={15} style={{ marginRight: '6px' }} /> Refresh Alerts
          </Button>
        </div>
      </div>

      {actionNotice && (
        <div className="action-toast" role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon name="check" size={16} color="#16a34a" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Filter Chips Bar */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>SEVERITY:</span>
          {['all', 'warning', 'critical', 'info'].map((sev) => (
            <button
              key={sev}
              className={`filter-chip ${severityFilter === sev ? 'filter-chip-active' : ''}`}
              onClick={() => setSeverityFilter(sev)}
            >
              {sev.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>STATUS:</span>
          {['all', 'open', 'acknowledged'].map((st) => (
            <button
              key={st}
              className={`filter-chip ${statusFilter === st ? 'filter-chip-active' : ''}`}
              onClick={() => setStatusFilter(st)}
            >
              {st.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton count={3} />
      ) : error ? (
        <AlertCallout severity="critical" title="Failed to Load Alerts" description={error} />
      ) : filteredAlerts.length === 0 ? (
        <EmptyState
          title="No Condition Alerts Found"
          description="No anomaly warnings match your selected filter criteria. Execute an analysis run on steady-state telemetry to evaluate machinery health."
        />
      ) : (
        <div className="alerts-stack" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {filteredAlerts.map((alert) => {
            const isAcknowledged = alert.status === ALERT_STATUSES.ACKNOWLEDGED;
            const hasWorkOrder = Boolean(alert.maintenanceWorkOrderId);
            const wo = alert.maintenanceWorkOrderId;

            return (
              <Card
                key={alert._id}
                title={alert.title}
                subtitle={`Machine: ${alert.machineId?.code || 'Equipment'} • Task: ${alert.analysisTask} • Model: ${alert.modelDetails?.modelName || 'Condition Model'}`}
                badge={
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {alert.triggeringPath && (
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background:
                            alert.triggeringPath === 'thermal_path'
                              ? '#fff7ed'
                              : alert.triggeringPath === 'fused_multisignal'
                              ? '#f5f3ff'
                              : '#eff6ff',
                          color:
                            alert.triggeringPath === 'thermal_path'
                              ? '#c2410c'
                              : alert.triggeringPath === 'fused_multisignal'
                              ? '#6d28d9'
                              : '#1d4ed8',
                          border:
                            alert.triggeringPath === 'thermal_path'
                              ? '1px solid #fed7aa'
                              : alert.triggeringPath === 'fused_multisignal'
                              ? '1px solid #ddd6fe'
                              : '1px solid #bfdbfe'
                        }}
                      >
                        {alert.triggeringPath === 'thermal_path'
                          ? 'THERMAL PATH'
                          : alert.triggeringPath === 'fused_multisignal'
                          ? 'MULTI-SIGNAL FUSED'
                          : 'VIBRATION PATH'}
                      </span>
                    )}
                    {alert.operatingRegime?.regimeId && (
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          background: '#f8fafc',
                          color: '#475569',
                          border: '1px solid #e2e8f0'
                        }}
                      >
                        {alert.operatingRegime.regimeId}
                      </span>
                    )}
                    <StatusBadge
                      status={alert.severity}
                      label={alert.severity.toUpperCase()}
                    />
                    <span
                      style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: isAcknowledged ? '#ecfdf5' : '#fef3c7',
                        color: isAcknowledged ? '#047857' : '#b45309',
                        border: isAcknowledged ? '1px solid #a7f3d0' : '1px solid #fde68a'
                      }}
                    >
                      {alert.status.toUpperCase()}
                    </span>
                    {hasWorkOrder && (
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe'
                        }}
                      >
                        WO: {wo.orderNumber || 'ASSIGNED'}
                      </span>
                    )}
                  </div>
                }
              >
                {/* Multi-Signal Fusion Rationale */}
                {alert.fusionRationale && (
                  <div style={{ padding: '0.75rem 1rem', background: '#f5f3ff', border: '1px solid rgba(124, 58, 237, 0.2)', borderRadius: '6px', fontSize: '0.85rem', color: '#5b21b6', marginBottom: '1rem' }}>
                    <strong>Multi-Signal Fusion Rationale:</strong> {alert.fusionRationale}
                  </div>
                )}

                {/* Scientific Disclaimer & Severity Note */}
                <div style={{ padding: '0.85rem', background: '#fffbeb', borderRadius: '6px', borderLeft: '4px solid #f59e0b', border: '1px solid #fef3c7', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#92400e', fontWeight: 600 }}>
                    <Icon name="alert" size={16} color="#d97706" />
                    <span>{alert.severityNote || 'Statistical Anomaly Identified'}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#78350f', marginTop: '0.35rem' }}>
                    Model Method: <strong>{alert.severityMethod}</strong> • Calibrated Score: <strong>{alert.scores?.peakScore?.toFixed(4) || '—'}</strong> (Threshold: {alert.scores?.calibratedThreshold?.toFixed(4) || '—'}) • Continuous prediction, not physical proof of mechanical failure.
                  </div>
                </div>

                {/* Interval Timing Metadata */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem', background: '#f8fafc', padding: '0.85rem', borderRadius: '6px', border: '1px solid #ede9f6' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Detected Time Interval:</span>
                    <div style={{ fontSize: '0.85rem', color: '#1e1b4b', fontWeight: 600 }}>
                      {alert.interval?.startTime ? `${new Date(alert.interval.startTime).toLocaleTimeString()} – ${new Date(alert.interval.endTime).toLocaleTimeString()}` : `Samples ${alert.interval?.startIdx} – ${alert.interval?.endIdx}`}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Sample Range:</span>
                    <div style={{ fontSize: '0.85rem', color: '#1e1b4b' }}>
                      {alert.interval?.sampleCount || (alert.interval?.endIdx - alert.interval?.startIdx) || 0} samples
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Data Sufficiency:</span>
                    <div style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                      {((alert.dataQuality?.sufficiencyScore ?? 1.0) * 100).toFixed(1)}% Steady-State
                    </div>
                  </div>
                </div>

                {/* Contributing Physical Signals */}
                {alert.contributingSignals && alert.contributingSignals.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e1b4b' }}>
                      Contributing Sensor Channels & Physical Baseline Delta:
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
                      {alert.contributingSignals.map((cs, idx) => (
                        <div key={idx} style={{ padding: '0.65rem 0.85rem', background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#4338ca' }}>{cs.signal}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.25rem' }}>
                            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                              {cs.peakValue?.toFixed ? cs.peakValue.toFixed(2) : cs.peakValue} {cs.unit}
                            </span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: (cs.deviationRatio || 0) > 0 ? '#dc2626' : '#16a34a' }}>
                              {cs.deviationRatio !== undefined ? `${(cs.deviationRatio * 100).toFixed(1)}% vs baseline` : ''}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem' }}>
                            Baseline: {cs.baselineMean?.toFixed ? cs.baselineMean.toFixed(2) : cs.baselineMean} {cs.unit}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Multi-Signal Detector Breakdown */}
                {alert.detectorBreakdown && (
                  <div style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
                    <div style={{ padding: '0.75rem 0.85rem', background: '#ffffff', borderRadius: '6px', border: '1px solid #ede9f6', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 700, color: '#0284c7' }}>
                        <Icon name="activity" size={14} color="#0284c7" /> Mechanical Vibration Path
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#334155', marginTop: '0.25rem' }}>
                        Detector:{' '}
                        <strong style={{ color: alert.detectorBreakdown.vibrationDetector?.isAnomalous ? '#dc2626' : '#16a34a' }}>
                          {alert.detectorBreakdown.vibrationDetector?.isAnomalous ? 'ANOMALOUS DEVIATION' : 'NOMINAL'}
                        </strong>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
                        Score: {Number(alert.detectorBreakdown.vibrationDetector?.score || 0).toFixed(4)} (Threshold: {Number(alert.detectorBreakdown.vibrationDetector?.threshold || 0).toFixed(4)})
                      </div>
                    </div>

                    <div style={{ padding: '0.75rem 0.85rem', background: '#ffffff', borderRadius: '6px', border: '1px solid #ede9f6', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 700, color: '#ea580c' }}>
                        <Icon name="thermometer" size={14} color="#ea580c" /> Thermal Path
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#334155', marginTop: '0.25rem' }}>
                        Detector:{' '}
                        <strong style={{ color: alert.detectorBreakdown.thermalDetector?.isAnomalous ? '#dc2626' : '#16a34a' }}>
                          {alert.detectorBreakdown.thermalDetector?.isAnomalous ? 'THERMAL RUNAWAY / DRIFT' : 'NORMAL'}
                        </strong>
                      </div>
                      {alert.detectorBreakdown.thermalDetector?.temperatureMean !== undefined && (
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
                          Temp Mean: {alert.detectorBreakdown.thermalDetector.temperatureMean} °C • Drift: {alert.detectorBreakdown.thermalDetector.driftRateCPerMin} °C/min
                        </div>
                      )}
                      {alert.detectorBreakdown.thermalDetector?.findings && (
                        <div style={{ fontSize: '0.72rem', color: '#ea580c', marginTop: '0.25rem' }}>
                          {alert.detectorBreakdown.thermalDetector.findings}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Contributing Features & SHAP Explanations */}
                {alert.shapAttribution && alert.shapAttribution.featureContributions && alert.shapAttribution.featureContributions.length > 0 && (
                  <div style={{ marginBottom: '1rem', background: '#f8f7fc', padding: '0.85rem', borderRadius: '6px', border: '1px solid #ede9f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e1b4b' }}>
                        Feature Attribution ({alert.shapAttribution.explainerType || 'TreeSHAP'}):
                      </span>
                      {alert.shapAttribution.additivityVerified && (
                        <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Icon name="check" size={13} color="#16a34a" /> Exact Additivity Verified
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                      {alert.shapAttribution.featureContributions.slice(0, 4).map((fc, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                          <span style={{ color: '#475569', fontFamily: 'monospace' }}>{fc.feature}</span>
                          <span style={{ color: fc.attribution > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                            {fc.attribution > 0 ? `+${fc.attribution.toFixed(4)}` : fc.attribution?.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Technician Observations Log */}
                {alert.technicianObservations && alert.technicianObservations.length > 0 && (
                  <div style={{ marginBottom: '1rem', borderTop: '1px solid #ede9f6', paddingTop: '0.75rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e1b4b' }}>
                      Technician Field Observations ({alert.technicianObservations.length}):
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                      {alert.technicianObservations.map((obs, idx) => (
                        <div key={idx} style={{ padding: '0.6rem 0.85rem', background: '#f8fafc', borderRadius: '4px', fontSize: '0.82rem', border: '1px solid #ede9f6' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.75rem' }}>
                            <strong>{obs.technicianName}</strong>
                            <span>{new Date(obs.loggedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div style={{ color: '#1e1b4b', marginTop: '0.25rem' }}>{obs.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add Observation Inline Form */}
                {activeObservationAlertId === alert._id ? (
                  <div style={{ marginTop: '0.75rem', padding: '0.85rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #ede9f6' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#1e1b4b', marginBottom: '0.4rem' }}>
                      Record Field Inspection Note:
                    </label>
                    <textarea
                      rows={2}
                      className="form-textarea"
                      placeholder="e.g. Inspected high-speed pinion; slight oil leakage observed around output seal..."
                      value={observationInput}
                      onChange={(e) => setObservationInput(e.target.value)}
                      style={{ width: '100%', marginBottom: '0.5rem' }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleObservationSubmit(alert._id)}
                        disabled={isSubmittingObs || !observationInput.trim()}
                      >
                        {isSubmittingObs ? 'Saving...' : 'Save Observation'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setActiveObservationAlertId(null);
                          setObservationInput('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* Action Buttons Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid #ede9f6', paddingTop: '0.75rem', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {!isViewer && activeObservationAlertId !== alert._id && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setActiveObservationAlertId(alert._id);
                          setObservationInput('');
                        }}
                      >
                        <Icon name="edit" size={14} style={{ marginRight: '5px' }} /> Add Observation
                      </Button>
                    )}
                    {isManager && !hasWorkOrder && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => openWorkOrderModal(alert)}
                      >
                        <Icon name="wrench" size={14} style={{ marginRight: '5px' }} /> Create Work Order
                      </Button>
                    )}
                    {alert.analysisRunId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`${ROUTES.ANALYSIS}?analysisRunId=${alert.analysisRunId?._id || alert.analysisRunId}`)}
                      >
                        <Icon name="analysis" size={13} style={{ marginRight: '5px' }} /> View Evidence
                      </Button>
                    )}
                    {alert.machineId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`#/machines/${alert.machineId?.code || alert.machineId}`)}
                      >
                        <Icon name="machine" size={13} style={{ marginRight: '4px' }} /> Machine {alert.machineId?.code || ''}
                      </Button>
                    )}
                    {hasWorkOrder && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`${ROUTES.MAINTENANCE}?machineId=${alert.machineId?.code || ''}`)}
                        style={{ color: '#7c3aed' }}
                      >
                        <Icon name="wrench" size={13} style={{ marginRight: '4px' }} /> Work Order [{alert.maintenanceWorkOrderId?.orderNumber || 'Linked'}]
                      </Button>
                    )}
                  </div>

                  <div>
                    {!isAcknowledged ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAcknowledge(alert._id)}
                        disabled={isViewer}
                      >
                        <Icon name="check" size={14} style={{ marginRight: '4px' }} /> Acknowledge Alert
                      </Button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Icon name="check" size={14} color="#16a34a" /> Acknowledged {alert.acknowledgedByName ? `by ${alert.acknowledgedByName}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Work Order Modal */}
      {workOrderModalAlert && (
        <div className="modal-backdrop">
          <div className="modal-container" style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h2>Assign Maintenance Work Order from Alert</h2>
              <button
                className="modal-close-btn"
                onClick={() => setWorkOrderModalAlert(null)}
                aria-label="Close modal"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {woError && (
              <AlertCallout severity="critical" title="Assignment Error" description={woError} />
            )}

            <form onSubmit={handleCreateWorkOrder}>
              <div className="form-group">
                <label className="form-label">Task Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={workOrderForm.title}
                  onChange={(e) => setWorkOrderForm({ ...workOrderForm, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Task Description</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={workOrderForm.description}
                  onChange={(e) => setWorkOrderForm({ ...workOrderForm, description: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    className="form-select"
                    value={workOrderForm.priority}
                    onChange={(e) => setWorkOrderForm({ ...workOrderForm, priority: e.target.value })}
                  >
                    <option value={WORK_ORDER_PRIORITY.LOW}>Low</option>
                    <option value={WORK_ORDER_PRIORITY.MEDIUM}>Medium</option>
                    <option value={WORK_ORDER_PRIORITY.HIGH}>High</option>
                    <option value={WORK_ORDER_PRIORITY.CRITICAL}>Critical</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={workOrderForm.dueDate}
                    onChange={(e) => setWorkOrderForm({ ...workOrderForm, dueDate: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assign Technician</label>
                <select
                  className="form-select"
                  value={workOrderForm.assignedTechnicianId}
                  onChange={(e) => setWorkOrderForm({ ...workOrderForm, assignedTechnicianId: e.target.value })}
                  required
                >
                  {technicians.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.fullName} ({t.email})
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem', display: 'block' }}>
                  Technician must belong to this factory and be assigned to this machine.
                </span>
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setWorkOrderModalAlert(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isCreatingWo}
                >
                  {isCreatingWo ? 'Creating...' : 'Assign Work Order'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
