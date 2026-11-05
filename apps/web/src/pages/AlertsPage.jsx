import React, { useState, useEffect, useMemo } from 'react';
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

/**
 * AlertsPage
 * Implements the UX Pilot Page 3 two-column industrial workspace:
 * Prioritized alerts queue on the left, focused evidence & work-order action panel on the right.
 */
export default function AlertsPage() {
  const { user } = useAuth();
  const { queryParams, navigate } = useRouter();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;
  const isViewer = user?.role === USER_ROLES.VIEWER;

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);

  // Status and Priority filters
  const [statusTab, setStatusTab] = useState('all'); // 'all' | 'open' | 'acknowledged' | 'wo_created' | 'resolved'
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [machineFilter, setMachineFilter] = useState('all');

  // Selected Alert for right panel detail
  const [selectedAlertId, setSelectedAlertId] = useState(null);

  // Observation / Note input state
  const [noteInput, setNoteInput] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

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
      const loadedAlerts = data.alerts || [];
      setAlerts(loadedAlerts);

      // Select first alert if none selected or if target passed in query
      if (loadedAlerts.length > 0) {
        if (queryParams?.alertId) {
          const matched = loadedAlerts.find((a) => a._id === queryParams.alertId);
          setSelectedAlertId(matched ? matched._id : loadedAlerts[0]._id);
        } else if (!selectedAlertId) {
          setSelectedAlertId(loadedAlerts[0]._id);
        }
      }
    } catch (err) {
      console.error('Fetch alerts error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch technicians for work order creation
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

  // Status Tab Counts
  const counts = useMemo(() => {
    const open = alerts.filter((a) => a.status === ALERT_STATUSES.OPEN && !a.maintenanceWorkOrderId).length;
    const ack = alerts.filter((a) => a.status === ALERT_STATUSES.ACKNOWLEDGED && !a.maintenanceWorkOrderId).length;
    const wo = alerts.filter((a) => Boolean(a.maintenanceWorkOrderId)).length;
    const resolved = alerts.filter((a) => a.status === ALERT_STATUSES.RESOLVED).length;
    return { open, ack, wo, resolved, total: alerts.length };
  }, [alerts]);

  // Unique Machines for Filter
  const uniqueMachines = useMemo(() => {
    const set = new Map();
    alerts.forEach((a) => {
      const code = a.machineId?.code || a.machineCode;
      if (code) set.set(code, a.machineId?.name || code);
    });
    return Array.from(set.entries()).map(([code, name]) => ({ code, name }));
  }, [alerts]);

  // Filtered Alerts List
  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (statusTab === 'open' && (a.status !== ALERT_STATUSES.OPEN || a.maintenanceWorkOrderId)) return false;
      if (statusTab === 'acknowledged' && (a.status !== ALERT_STATUSES.ACKNOWLEDGED || a.maintenanceWorkOrderId)) return false;
      if (statusTab === 'wo_created' && !a.maintenanceWorkOrderId) return false;
      if (statusTab === 'resolved' && a.status !== ALERT_STATUSES.RESOLVED) return false;

      if (priorityFilter !== 'all') {
        if (priorityFilter === 'high' && a.severity !== ALERT_SEVERITIES.CRITICAL && a.severity !== 'high') return false;
        if (priorityFilter === 'medium' && a.severity !== ALERT_SEVERITIES.WARNING && a.severity !== 'medium') return false;
        if (priorityFilter === 'low' && a.severity !== ALERT_SEVERITIES.INFO && a.severity !== 'low') return false;
      }

      if (machineFilter !== 'all') {
        const c = a.machineId?.code || a.machineCode;
        if (c !== machineFilter) return false;
      }

      return true;
    });
  }, [alerts, statusTab, priorityFilter, machineFilter]);

  // Active Selected Alert
  const selectedAlert = useMemo(() => {
    if (!selectedAlertId) return filteredAlerts[0] || alerts[0] || null;
    return alerts.find((a) => a._id === selectedAlertId) || filteredAlerts[0] || null;
  }, [alerts, selectedAlertId, filteredAlerts]);

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

      setAlerts((prev) =>
        prev.map((a) =>
          a._id === alertId
            ? { ...a, status: ALERT_STATUSES.ACKNOWLEDGED, acknowledgedByName: user?.fullName }
            : a
        )
      );
      setActionNotice('Alert acknowledged. Review recorded in audit trail.');
      setTimeout(() => setActionNotice(null), 4000);
    } catch (err) {
      alert(err.message);
    }
  };

  // Add Note handler
  const handleAddNote = async (alertId) => {
    if (!noteInput.trim()) return;
    setIsSubmittingNote(true);
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
        body: JSON.stringify({ note: noteInput.trim() })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to record note.');
      }

      const data = await res.json();
      setAlerts((prev) =>
        prev.map((a) => (a._id === alertId ? data.alert : a))
      );
      setNoteInput('');
      setActionNotice('Note added to alert record.');
      setTimeout(() => setActionNotice(null), 4000);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // Open Work Order modal pre-filled from alert
  const openWorkOrderModal = (alert) => {
    setWorkOrderModalAlert(alert);
    setWoError(null);
    setWorkOrderForm({
      title: `Inspect ${alert.machineId?.code || alert.machineCode || 'Machine'} — ${alert.title}`,
      description: `Investigate condition alert (${alert._id}). ${alert.severityNote || alert.description || 'Check for physical wear or sensor anomaly.'}`,
      priority: alert.severity === ALERT_SEVERITIES.CRITICAL || alert.severity === 'high' ? WORK_ORDER_PRIORITY.HIGH : WORK_ORDER_PRIORITY.MEDIUM,
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      assignedTechnicianId: technicians[0]?._id || ''
    });
  };

  // Submit Work Order creation
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

      setAlerts((prev) =>
        prev.map((a) =>
          a._id === workOrderModalAlert._id
            ? { ...a, maintenanceWorkOrderId: data.workOrder }
            : a
        )
      );

      setWorkOrderModalAlert(null);
      setActionNotice(`Work order [${data.workOrder.orderNumber}] created successfully.`);
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err) {
      console.error('Work order creation error:', err);
      setWoError(err.message);
    } finally {
      setIsCreatingWo(false);
    }
  };

  return (
    <div className="page-container">
      {/* Page Header (UX Pilot Page 3) */}
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-demo">DEMO DATA</span>
            <span className="badge badge-operational">CONDITION SURVEILLANCE</span>
          </div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">
            Raised from completed analyses and data-freshness rules. Sorted by priority, then newest.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Button variant="secondary" size="sm" onClick={fetchAlerts} icon="refresh">
            Refresh Alerts
          </Button>
        </div>
      </div>

      {actionNotice && (
        <div className="action-toast" role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon name="check" size={16} color="#16a34a" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Top Filter Bar: Status Tabs & Dropdowns (UX Pilot Page 3) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          background: '#ffffff',
          padding: '0.75rem 1rem',
          borderRadius: '10px',
          border: '1px solid var(--border-subtle)'
        }}
      >
        {/* Status Filter Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`filter-pill-btn ${statusTab === 'all' ? 'active' : ''}`}
            onClick={() => setStatusTab('all')}
          >
            All ({counts.total})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${statusTab === 'open' ? 'active' : ''}`}
            onClick={() => setStatusTab('open')}
          >
            Open ({counts.open})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${statusTab === 'acknowledged' ? 'active' : ''}`}
            onClick={() => setStatusTab('acknowledged')}
          >
            Acknowledged ({counts.ack})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${statusTab === 'wo_created' ? 'active' : ''}`}
            onClick={() => setStatusTab('wo_created')}
          >
            Work order created ({counts.wo})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${statusTab === 'resolved' ? 'active' : ''}`}
            onClick={() => setStatusTab('resolved')}
          >
            Resolved ({counts.resolved})
          </button>
        </div>

        {/* Dropdowns */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            className="form-select text-xs"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            style={{ width: 'auto', padding: '0.35rem 0.65rem' }}
          >
            <option value="all">All priorities</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>

          <select
            className="form-select text-xs"
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            style={{ width: 'auto', padding: '0.35rem 0.65rem' }}
          >
            <option value="all">All machines</option>
            {uniqueMachines.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} ({m.name})
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton count={3} />
      ) : error ? (
        <AlertCallout severity="critical" title="Failed to Load Alerts" description={error} />
      ) : filteredAlerts.length === 0 ? (
        <EmptyState
          title="No Alerts Found"
          description="No anomaly warnings match your selected filter criteria. Upload and analyze telemetry to evaluate machine health."
        />
      ) : (
        /* TWO-COLUMN SPLIT WORKSPACE (UX Pilot Page 3) */
        <div className="alerts-workspace-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.25fr', gap: '1.25rem', alignItems: 'start' }}>
          {/* LEFT COLUMN: ALERTS LIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredAlerts.map((alert) => {
              const isSelected = selectedAlert?._id === alert._id;
              const isHigh = alert.severity === ALERT_SEVERITIES.CRITICAL || alert.severity === 'high';
              const isMedium = alert.severity === ALERT_SEVERITIES.WARNING || alert.severity === 'medium';
              const isAck = alert.status === ALERT_STATUSES.ACKNOWLEDGED;
              const hasWo = Boolean(alert.maintenanceWorkOrderId);

              const priorityColor = isHigh ? '#dc2626' : isMedium ? '#d97706' : '#64748b';
              const priorityLabel = isHigh ? 'HIGH' : isMedium ? 'MEDIUM' : 'LOW';

              return (
                <div
                  key={alert._id}
                  onClick={() => setSelectedAlertId(alert._id)}
                  style={{
                    background: '#ffffff',
                    borderRadius: '8px',
                    border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                    borderLeft: `4px solid ${priorityColor}`,
                    padding: '1rem',
                    cursor: 'pointer',
                    boxShadow: isSelected ? '0 4px 12px rgba(15, 118, 110, 0.12)' : '0 1px 3px rgba(0,0,0,0.02)',
                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedAlertId(alert._id); }}
                >
                  {/* Top Line: Priority | Alert ID | Timestamp & Status Tag */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <strong style={{ color: priorityColor }}>{priorityLabel}</strong>
                      <span className="text-muted">•</span>
                      <span className="mono-code text-muted">{alert.alertCode || alert._id.slice(-6).toUpperCase()}</span>
                      <span className="text-muted">•</span>
                      <span className="text-muted">
                        {alert.createdAt ? new Date(alert.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Just now'}
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: hasWo ? '#eff6ff' : isAck ? '#ecfdf5' : '#fef2f2',
                        color: hasWo ? '#1d4ed8' : isAck ? '#059669' : '#dc2626'
                      }}
                    >
                      {hasWo ? 'Work order created' : isAck ? 'Acknowledged' : 'Not acknowledged'}
                    </span>
                  </div>

                  {/* Headline: Machine & Title */}
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                    <strong>{alert.machineId?.code || alert.machineCode || 'Machine'}</strong> · {alert.title}
                  </div>

                  {/* Summary of Evidence Snippet */}
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.775rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {alert.severityNote || alert.description || 'Observed deviation from baseline operating profile.'}
                  </p>

                  {/* Footer Tag: Originating Analysis & Model */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span className="mono-code">{alert.analysisRunId?.runNumber || 'AN-RUN'}</span>
                    <span>•</span>
                    <span>{alert.modelDetails?.modelName || 'Condition Detector'}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT COLUMN: FOCUSED ALERT DETAIL VIEW (UX Pilot Page 3) */}
          {selectedAlert ? (
            <div
              style={{
                background: '#ffffff',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                position: 'sticky',
                top: '1rem'
              }}
            >
              {/* Detail Header */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <span
                    className={`badge badge-${
                      selectedAlert.severity === ALERT_SEVERITIES.CRITICAL || selectedAlert.severity === 'high'
                        ? 'critical'
                        : selectedAlert.severity === ALERT_SEVERITIES.WARNING || selectedAlert.severity === 'medium'
                        ? 'warning'
                        : 'operational'
                    }`}
                  >
                    {(selectedAlert.severity || 'HIGH').toUpperCase()} PRIORITY
                  </span>
                  <span className="mono-code text-muted text-xs">
                    {selectedAlert.alertCode || selectedAlert._id}
                  </span>
                </div>

                <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>
                  {selectedAlert.machineId?.code || selectedAlert.machineCode} · {selectedAlert.title}
                </h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {selectedAlert.machineId?.name || 'Main Drive Machinery'} · {selectedAlert.machineId?.location || 'Plant Floor'}
                </p>
              </div>

              {/* Evidence Panel (UX Pilot Page 3) */}
              <div
                style={{
                  background: 'var(--bg-surface-subtle)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  padding: '1rem'
                }}
              >
                <span className="text-xs text-muted block" style={{ fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                  Evidence
                </span>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '0.85rem' }}>
                  <div style={{ background: '#ffffff', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-muted text-xs block">Class probability</span>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                      {selectedAlert.scores?.peakScore !== undefined ? selectedAlert.scores.peakScore.toFixed(2) : '0.64'}
                    </strong>
                  </div>

                  <div style={{ background: '#ffffff', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-muted text-xs block">GMF sideband</span>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--status-critical)' }}>
                      +4.1 dB
                    </strong>
                  </div>

                  <div style={{ background: '#ffffff', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-muted text-xs block">Peak RMS</span>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                      {selectedAlert.contributingSignals?.[0]?.peakValue
                        ? `${Number(selectedAlert.contributingSignals[0].peakValue).toFixed(2)} g`
                        : '0.71 g'}
                    </strong>
                  </div>

                  <div style={{ background: '#ffffff', padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-muted text-xs block">Data range</span>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {selectedAlert.interval?.startTime
                        ? `${new Date(selectedAlert.interval.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(selectedAlert.interval.endTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                        : 'Recent uploaded run'}
                    </strong>
                  </div>
                </div>

                <p className="text-secondary text-xs" style={{ margin: '0 0 0.65rem 0', fontStyle: 'italic', lineHeight: 1.4 }}>
                  Classifier evaluated on simulator data only. Confirm by physical inspection before replacing parts.
                </p>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(ROUTES.ANALYSIS)}
                  icon="chart"
                >
                  Open analysis {selectedAlert.analysisRunId?.runNumber || 'AN-RUN'} →
                </Button>
              </div>

              {/* Notes & History (UX Pilot Page 3) */}
              <div>
                <span className="text-xs text-muted block" style={{ fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                  Notes & history
                </span>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  <div style={{ fontSize: '0.775rem', background: 'var(--bg-surface-subtle)', padding: '0.6rem', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      Alert raised by analysis {selectedAlert.analysisRunId?.runNumber || 'system'}
                    </div>
                    <span className="text-muted text-xs">
                      {selectedAlert.createdAt ? new Date(selectedAlert.createdAt).toLocaleString() : 'System event'}
                    </span>
                  </div>

                  {(selectedAlert.observations || []).map((obs, idx) => (
                    <div key={idx} style={{ fontSize: '0.775rem', background: '#f8fafc', padding: '0.6rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ color: 'var(--text-primary)' }}>{obs.note}</div>
                      <span className="text-muted text-xs">
                        {obs.loggedByName || 'Technician'} • {new Date(obs.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Add Note Form */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="input-field text-xs"
                    placeholder="Add a note for the record…"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddNote(selectedAlert._id);
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isSubmittingNote}
                    onClick={() => handleAddNote(selectedAlert._id)}
                  >
                    Add note
                  </Button>
                </div>
              </div>

              {/* Action Buttons (UX Pilot Page 3) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                {isManager && (
                  <Button
                    variant="primary"
                    onClick={() => openWorkOrderModal(selectedAlert)}
                    icon="wrench"
                  >
                    Create work order
                  </Button>
                )}

                <Button
                  variant="secondary"
                  onClick={() => handleAcknowledge(selectedAlert._id)}
                  disabled={selectedAlert.status === ALERT_STATUSES.ACKNOWLEDGED}
                  icon="check"
                >
                  {selectedAlert.status === ALERT_STATUSES.ACKNOWLEDGED ? 'Acknowledged' : 'Acknowledge'}
                </Button>

                <span className="text-muted text-xs" style={{ textAlign: 'center', lineHeight: 1.35 }}>
                  Acknowledging records your review. It doesn't close the alert.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* CREATE WORK ORDER MODAL */}
      {workOrderModalAlert && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-wo-title">
          <div className="modal-card">
            <div className="modal-header">
              <h3 id="modal-wo-title" className="modal-title">
                Create Work Order from Alert
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setWorkOrderModalAlert(null)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateWorkOrder}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {woError && (
                  <AlertCallout severity="critical" title="Creation Error" description={woError} />
                )}

                <div className="form-group">
                  <label className="form-label">Task Title</label>
                  <input
                    type="text"
                    className="input-field"
                    value={workOrderForm.title}
                    onChange={(e) => setWorkOrderForm((prev) => ({ ...prev, title: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Work Instructions & Notes</label>
                  <textarea
                    className="input-field"
                    rows={3}
                    value={workOrderForm.description}
                    onChange={(e) => setWorkOrderForm((prev) => ({ ...prev, description: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid-two-col" style={{ gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <select
                      className="form-select"
                      value={workOrderForm.priority}
                      onChange={(e) => setWorkOrderForm((prev) => ({ ...prev, priority: e.target.value }))}
                    >
                      <option value={WORK_ORDER_PRIORITY.CRITICAL}>Critical</option>
                      <option value={WORK_ORDER_PRIORITY.HIGH}>High</option>
                      <option value={WORK_ORDER_PRIORITY.MEDIUM}>Medium</option>
                      <option value={WORK_ORDER_PRIORITY.LOW}>Low</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Due Date</label>
                    <input
                      type="date"
                      className="input-field"
                      value={workOrderForm.dueDate}
                      onChange={(e) => setWorkOrderForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Assign Technician</label>
                  <select
                    className="form-select"
                    value={workOrderForm.assignedTechnicianId}
                    onChange={(e) => setWorkOrderForm((prev) => ({ ...prev, assignedTechnicianId: e.target.value }))}
                    required
                  >
                    {technicians.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.fullName} ({t.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <Button variant="secondary" onClick={() => setWorkOrderModalAlert(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={isCreatingWo}>
                  {isCreatingWo ? 'Creating...' : 'Assign & Dispatch'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
