import React, { useState, useEffect, useCallback } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import Icon from '../components/common/Icon.jsx';
import {
  USER_ROLES,
  WORK_ORDER_STATUS,
  WORK_ORDER_PRIORITY,
  OPERATIONAL_STATUS,
  MACHINE_TYPES,
  MACHINE_TYPE_LABELS
} from '@predictive-maintenance/shared';
import { useRouter, ROUTES } from '../router/Router.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function MachineDetailPage() {
  const { params, navigate } = useRouter();
  const { user } = useAuth();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;
  const isTechnician = user?.role === USER_ROLES.TECHNICIAN;
  const machineCode = params?.id || 'GB-104';

  const [machine, setMachine] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);
  const [machineDatasets, setMachineDatasets] = useState([]);
  const [machineAlerts, setMachineAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('kinematics');

  // Maintenance note form
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('Field Inspection');
  const [noteSuccess, setNoteSuccess] = useState(null);
  const [noteError, setNoteError] = useState(null);

  // Work Order Modals
  const [showCreateOrderModal, setShowCreateOrderModal] = useState(false);
  const [showCompleteOrderModal, setShowCompleteOrderModal] = useState(null);
  const [showReviewOrderModal, setShowReviewOrderModal] = useState(null);
  const [showDecommissionModal, setShowDecommissionModal] = useState(false);
  const [decommissionReason, setDecommissionReason] = useState('');
  const [orderFormError, setOrderFormError] = useState(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  // New Work Order Form State
  const [newOrder, setNewOrder] = useState({
    title: '',
    description: '',
    priority: WORK_ORDER_PRIORITY.MEDIUM,
    dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split('T')[0],
    assignedTechnicianId: ''
  });

  // Technician Completion Feedback Form State
  const [completionFeedback, setCompletionFeedback] = useState({
    findings: '',
    workPerformed: '',
    followUpNeeded: '',
    note: ''
  });

  // Manager Review Notes Form State
  const [reviewNote, setReviewNote] = useState('');

  const fetchMachineAndOrders = useCallback(async () => {
    setLoading(true);
    setErrorStatus(null);
    setErrorMessage(null);

    try {
      // 1. Fetch machine profile
      const mRes = await fetch(`${API_BASE}/machines/${machineCode}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      const mData = await mRes.json();
      if (!mRes.ok) {
        setErrorStatus(mRes.status);
        setErrorMessage(mData.message || `HTTP ${mRes.status}: Access Denied`);
        setLoading(false);
        return;
      }

      setMachine(mData.machine);

      // Default assigned technician to first technician if available
      if (mData.machine.assignedTechnicians?.length > 0 && !newOrder.assignedTechnicianId) {
        setNewOrder((prev) => ({
          ...prev,
          assignedTechnicianId: mData.machine.assignedTechnicians[0]._id
        }));
      }

      // 2. Fetch work orders for this machine
      const woRes = await fetch(`${API_BASE}/machines/${machineCode}/work-orders`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (woRes.ok) {
        const woData = await woRes.json();
        setWorkOrders(woData.workOrders || []);
      }

      // 3. Fetch uploaded datasets for this machine
      const dsRes = await fetch(`${API_BASE}/datasets?machineId=${mData.machine._id}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (dsRes.ok) {
        const dsData = await dsRes.json();
        setMachineDatasets(dsData.datasets || []);
      }

      // 4. Fetch evidence alerts for this machine
      const alertRes = await fetch(`${API_BASE}/alerts?machineId=${mData.machine._id}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (alertRes.ok) {
        const alertData = await alertRes.json();
        setMachineAlerts(alertData.alerts || []);
      }
    } catch (err) {
      setErrorStatus(500);
      setErrorMessage(err.message || 'Failed to connect to machine ledger API');
    } finally {
      setLoading(false);
    }
  }, [machineCode, newOrder.assignedTechnicianId]);

  useEffect(() => {
    fetchMachineAndOrders();
  }, [fetchMachineAndOrders]);

  // Handle Maintenance Note Logging
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

      setNoteSuccess('Maintenance field note recorded in permanent machine ledger.');
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

  // Handle Create Work Order
  const handleCreateWorkOrder = async (e) => {
    e.preventDefault();
    setOrderFormError(null);
    setOrderSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/machines/${machineCode}/work-orders`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(newOrder)
      });

      const data = await res.json();
      if (!res.ok) {
        setOrderFormError(data.message || `Failed to create work order: ${res.status}`);
        return;
      }

      setShowCreateOrderModal(false);
      setNewOrder({
        title: '',
        description: '',
        priority: WORK_ORDER_PRIORITY.MEDIUM,
        dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split('T')[0],
        assignedTechnicianId: machine.assignedTechnicians?.[0]?._id || ''
      });
      fetchMachineAndOrders();
    } catch (err) {
      setOrderFormError(err.message || 'Network error creating work order.');
    } finally {
      setOrderSubmitting(false);
    }
  };

  // Handle Status Update for Work Order
  const handleUpdateOrderStatus = async (orderId, targetStatus, extraPayload = {}) => {
    try {
      const res = await fetch(`${API_BASE}/work-orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          status: targetStatus,
          ...extraPayload
        })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.message || `Failed to update work order: ${res.status}`);
        return;
      }

      setShowCompleteOrderModal(null);
      setShowReviewOrderModal(null);
      fetchMachineAndOrders();
    } catch (err) {
      alert(`Network error updating work order: ${err.message}`);
    }
  };

  // Handle Soft-Decommissioning
  const handleDecommission = async () => {
    try {
      const res = await fetch(`${API_BASE}/machines/${machineCode}/decommission`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ reason: decommissionReason })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.message || `Decommission failed: ${res.status}`);
        return;
      }

      setShowDecommissionModal(false);
      fetchMachineAndOrders();
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="text-secondary">Loading gearbox engineering profile from plant database...</p>
      </div>
    );
  }

  // Scoped error display (403 Forbidden, 404 Not Found, or 500 Connection Failure)
  if (errorStatus) {
    const isNotFound = errorStatus === 404;
    const isForbidden = errorStatus === 403;

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
          title={
            isNotFound
              ? 'Machine Not Found in Factory Scope'
              : isForbidden
              ? 'Access Denied to Machine'
              : 'Machine Ledger Service Unavailable'
          }
          badge={<StatusBadge status={isNotFound ? 'critical' : 'warning'} label={`HTTP ${errorStatus}`} />}
        >
          <AlertCallout
            severity={isNotFound ? 'critical' : 'warning'}
            title={
              isNotFound
                ? '404 Scoped Boundary Isolation'
                : isForbidden
                ? '403 Unauthorized Equipment Assignment'
                : 'Connection or API Execution Failure'
            }
            description={
              isNotFound
                ? `Equipment "${machineCode}" does not exist within your factory scope (${user?.factoryId?.name || 'Factory'}). To prevent data leakage, cross-factory machine existence is never disclosed.`
                : isForbidden
                ? `Your account (${user?.fullName}, ${user?.role}) is not assigned to equipment "${machineCode}". Access is denied by backend middleware.`
                : (errorMessage || `Failed to retrieve equipment "${machineCode}" from the plant database. Please verify API server connectivity.`)
            }
            action={
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="secondary" onClick={() => navigate(ROUTES.MACHINES)}>
                  ← Return to Accessible Machines
                </Button>
                {!isNotFound && !isForbidden && (
                  <Button variant="primary" onClick={fetchMachineAndOrders}>
                    Retry Connection
                  </Button>
                )}
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  if (!machine) return null;

  const machineId = machine.code || machine.id;
  const isDecomm = machine.isDecommissioned || machine.operationalStatus === OPERATIONAL_STATUS.DECOMMISSIONED;
  const machineAlert = machineAlerts.find((a) => a.status === 'active' || a.status === 'acknowledged') || machineAlerts[0];
  const stages = machine.stages || [];
  const signals = machine.monitoredSignals || [];
  const notes = machine.notes || [];
  const assignedTechs = machine.assignedTechnicians || [];

  const latestDataset = machineDatasets.length > 0
    ? [...machineDatasets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    : null;
  const telemetryFreshness = latestDataset
    ? `Latest Ingestion: ${new Date(latestDataset.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : 'No Telemetry Uploaded Yet';

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
            <span className="badge badge-site">
              {MACHINE_TYPE_LABELS[machine.type] || machine.type || 'Equipment'}
            </span>
            <span className={`badge ${isDecomm ? 'badge-critical' : 'badge-info'}`}>
              {machine.operationalStatus?.toUpperCase() || 'OPERATIONAL'}
            </span>
            <StatusBadge
              status={machine.status}
              label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'}
              isSimulated={!machine._id}
            />
            <span
              className={`badge ${latestDataset ? 'badge-info' : 'badge-neutral'}`}
              title={latestDataset ? `Filename: ${latestDataset.originalFilename}` : undefined}
            >
              <Icon name="clock" size={11} style={{ marginRight: 4 }} />
              {telemetryFreshness}
            </span>
          </div>
          <h1 className="page-title">{machine.name}</h1>
          <p className="page-subtitle">
            {machine.manufacturer} • Model {machine.model} • Serial: {machine.serialNumber || 'N/A'} • Site: {machine.siteId?.name || machine.site || 'Plant Floor'}
          </p>
        </div>

        <div className="page-header-actions">
          {isManager && !isDecomm && (
            <Button
              variant="outline"
              onClick={() => setShowDecommissionModal(true)}
              style={{ color: '#fca5a5', borderColor: 'rgba(239, 68, 68, 0.4)' }}
            >
              Decommission
            </Button>
          )}

          {isManager && (
            <Button
              variant="secondary"
              onClick={() => {
                setOrderFormError(null);
                setShowCreateOrderModal(true);
              }}
              disabled={isDecomm}
              title={isDecomm ? 'Cannot assign tasks to decommissioned machine' : 'Assign maintenance task'}
            >
              <Icon name="plus" size={14} style={{ marginRight: 6 }} /> Create Work Order
            </Button>
          )}

          <Button
            variant="primary"
            onClick={() => navigate(`${ROUTES.DATASETS_UPLOAD}?machineId=${machine._id || machineId}`)}
            disabled={isDecomm}
            title={isDecomm ? 'Cannot upload data for decommissioned machine' : 'Upload dataset'}
          >
            <Icon name="upload" size={14} style={{ marginRight: 6 }} /> Upload Telemetry
          </Button>
        </div>
      </div>

      {/* Decommission Banner if applicable */}
      {isDecomm && (
        <div style={{
          backgroundColor: '#fef2f2',
          borderColor: '#fecaca',
          borderWidth: 1,
          borderStyle: 'solid',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16
        }}>
          <h3 style={{ margin: 0, color: '#991b1b', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={16} color="#dc2626" /> Gearbox Specimen is Soft-Decommissioned
          </h3>
          <p style={{ margin: '4px 0 0', color: '#7f1d1d', fontSize: 13 }}>
            This gearbox has been taken out of active operational rotation. Historical kinematic records, past maintenance work orders, and field notes are preserved for auditing, but new operational dataset uploads and work orders are disallowed.
          </p>
          {machine.decommissionReason && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
              <strong>Decommission Reason:</strong> {machine.decommissionReason}
            </div>
          )}
        </div>
      )}

      {/* Active Warning Callout if present */}
      {machineAlert && (
        <AlertCallout
          severity={machineAlert.severity}
          title={`Active Warning: ${machineAlert.title}`}
          description={machineAlert.description}
          timestamp={
            machineAlert.createdAt || machineAlert.timestamp
              ? new Date(machineAlert.createdAt || machineAlert.timestamp).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : undefined
          }
          contributingSignals={machineAlert.contributingSignals}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(ROUTES.ALERTS)}
            >
              <span>Review Warnings Dashboard</span>
              <Icon name="arrowRight" size={13} style={{ marginLeft: 6 }} />
            </Button>
          }
        />
      )}

      {/* Detail Tabs */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'kinematics' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('kinematics')}
        >
          Kinematics & Lubrication
        </button>
        <button
          className={`tab-btn ${activeTab === 'workorders' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('workorders')}
        >
          Maintenance Work Orders ({workOrders.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'sensors' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('sensors')}
        >
          Sensor Channels ({signals.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'notes' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          Field Notes & History ({notes.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'datasets' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('datasets')}
        >
          Uploaded Datasets ({machineDatasets.length})
        </button>
      </div>

      {/* ================= TAB 1: Kinematics & Lubrication ================= */}
      {activeTab === 'kinematics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Kinematic Stages Breakdown */}
          <Card
            title={`Multi-Stage Reduction Architecture (${machine.arrangement || 'Helical-Planetary'})`}
            subtitle="Mechanical stage ratios, mesh parameters, and kinematic transmission stages"
          >
            <div className="stage-diagram-row">
              {stages.map((stg) => (
                <div key={stg.stage} className="stage-diagram-card">
                  <div className="stage-header">
                    <span className="stage-index">Stage {stg.stage}</span>
                    <span className="stage-kind">{stg.type}</span>
                  </div>
                  <div className="stage-ratio-box">
                    <span className="ratio-label">Ratio:</span>
                    <span className="ratio-value">{stg.ratio}</span>
                  </div>
                  {stg.teethPinion && (
                    <div style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0' }}>
                      Pinion / Gear Teeth: <strong>{stg.teethPinion}T / {stg.teethGear}T</strong>
                    </div>
                  )}
                  <div className="stage-condition-badge">
                    <span>{stg.conditionNotes || stg.condition || 'Nominal Condition'}</span>
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

          {/* Bearings and Lubrication Specifications */}
          <div className="grid-two-col">
            <Card
              title="Bearing Positions & Enclosure Points"
              subtitle="Critical bearing support locations for vibration transducer placement"
            >
              {machine.bearingPositions && machine.bearingPositions.length > 0 ? (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th>Type</th>
                        <th>Model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {machine.bearingPositions.map((b, idx) => (
                        <tr key={idx}>
                          <td className="table-primary-text">{b.position}</td>
                          <td>{b.bearingType || 'Industrial Roller'}</td>
                          <td><span className="mono-code">{b.bearingModel || 'N/A'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-secondary">Standard drive-end (DE) and non-drive-end (NDE) bearing arrangement.</p>
              )}
            </Card>

            <Card
              title="Lubrication & Fluid Specifications"
              subtitle="Viscosity rating, sump volume, and manufacturer maintenance window"
            >
              <div className="kv-list">
                <div className="kv-item">
                  <span className="kv-key">Lubricant Oil Type</span>
                  <span className="kv-val">{machine.lubrication?.oilType || machine.lubricantType || 'ISO VG 220 Synthetic'}</span>
                </div>
                <div className="kv-item">
                  <span className="kv-key">ISO Viscosity Grade</span>
                  <span className="kv-val mono-code">{machine.lubrication?.isoVgGrade || 'ISO VG 220'}</span>
                </div>
                <div className="kv-item">
                  <span className="kv-key">Oil Sump Capacity</span>
                  <span className="kv-val">{machine.lubrication?.capacityLiters ? `${machine.lubrication.capacityLiters} L` : '18.5 Liters'}</span>
                </div>
                <div className="kv-item">
                  <span className="kv-key">Service Interval</span>
                  <span className="kv-val">{machine.lubrication?.serviceIntervalHours ? `${machine.lubrication.serviceIntervalHours} Operating Hours` : '4000 Hours'}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Assigned Technicians */}
          <Card
            title="Assigned Field Technicians"
            subtitle="Technicians authorized to log maintenance, inspect gear stages, and execute work orders on this machine"
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {assignedTechs.length > 0 ? (
                assignedTechs.map((t) => (
                  <div key={t._id || t} style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #ede9f6',
                    borderRadius: 8,
                    padding: '10px 14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                  }}>
                    <div style={{ fontWeight: 700, color: '#1e1b4b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="user" size={13} color="#7c3aed" /> {t.fullName || t.name || 'Technician'}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                      {t.email} • {t.role?.toUpperCase()}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-secondary">No technicians currently assigned. Only Factory Managers have access.</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ================= TAB 2: Maintenance Work Orders ================= */}
      {activeTab === 'workorders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                Machine Work Order & Task Ledger
              </h2>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>
                Server-audited task assignment lifecycle: Open → Accepted → In Progress → Completed → Reviewed.
              </p>
            </div>
            {isManager && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setOrderFormError(null);
                  setShowCreateOrderModal(true);
                }}
                disabled={isDecomm}
              >
                + New Work Order
              </Button>
            )}
          </div>

          {workOrders.length === 0 ? (
            <Card title="No Work Orders Assigned">
              <p className="text-secondary">
                There are no open or past maintenance tasks recorded for this gearbox specimen.
              </p>
            </Card>
          ) : (
            workOrders.map((order) => {
              const isAssignedTech = order.assignedTechnicianId?._id === user?._id;
              const canProgress = isManager || isAssignedTech;

              return (
                <Card
                  key={order._id}
                  title={`[${order.orderNumber}] ${order.title}`}
                  subtitle={`Assigned to: ${order.assignedTechnicianId?.fullName || 'Technician'} • Created by: ${order.createdById?.fullName || 'Manager'}`}
                  badge={
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className={`badge ${
                        order.priority === 'urgent' || order.priority === 'high' ? 'badge-critical' : 'badge-info'
                      }`}>
                        {order.priority?.toUpperCase()} PRIORITY
                      </span>
                      <span className={`badge ${
                        order.status === WORK_ORDER_STATUS.REVIEWED ? 'badge-healthy' :
                        order.status === WORK_ORDER_STATUS.COMPLETED ? 'badge-info' :
                        order.status === WORK_ORDER_STATUS.IN_PROGRESS ? 'badge-warning' : 'badge-demo'
                      }`}>
                        {order.status?.toUpperCase()}
                      </span>
                    </div>
                  }
                  footer={
                    <div className="card-footer-split">
                      <span className="footer-meta">
                        Due: {new Date(order.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {order.completedAt && ` • Completed: ${new Date(order.completedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                        {order.reviewedAt && ` • Reviewed: ${new Date(order.reviewedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                      </span>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {canProgress && order.status === WORK_ORDER_STATUS.OPEN && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUpdateOrderStatus(order._id, WORK_ORDER_STATUS.ACCEPTED, { note: 'Work order accepted by technician' })}
                          >
                            Accept Task
                          </Button>
                        )}

                        {canProgress && (order.status === WORK_ORDER_STATUS.OPEN || order.status === WORK_ORDER_STATUS.ACCEPTED) && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleUpdateOrderStatus(order._id, WORK_ORDER_STATUS.IN_PROGRESS, { note: 'Commenced field inspection and disassembly' })}
                          >
                            Start Work
                          </Button>
                        )}

                        {canProgress && order.status === WORK_ORDER_STATUS.IN_PROGRESS && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setCompletionFeedback({ findings: '', workPerformed: '', followUpNeeded: '', note: '' });
                              setShowCompleteOrderModal(order);
                            }}
                          >
                            Complete Work Order
                          </Button>
                        )}

                        {isManager && order.status === WORK_ORDER_STATUS.COMPLETED && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setReviewNote('');
                              setShowReviewOrderModal(order);
                            }}
                          >
                            Review & Close (Manager)
                          </Button>
                        )}
                      </div>
                    </div>
                  }
                >
                  <p style={{ color: '#cbd5e1', fontSize: 13, margin: '0 0 10px', lineHeight: 1.5 }}>
                    {order.description}
                  </p>

                  {/* Technician Feedback if completed */}
                  {order.technicianFeedback && (order.technicianFeedback.findings || order.technicianFeedback.workPerformed) && (
                    <div style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #ede9f6',
                      borderRadius: 6,
                      padding: '10px 14px',
                      marginBottom: 10,
                      gap: 6
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#4338ca', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="edit" size={13} color="#4338ca" /> Technician Field Report:
                      </div>
                      {order.technicianFeedback.findings && (
                        <div style={{ fontSize: 12, color: '#334155' }}>
                          <strong>Inspection Findings:</strong> {order.technicianFeedback.findings}
                        </div>
                      )}
                      {order.technicianFeedback.workPerformed && (
                        <div style={{ fontSize: 12, color: '#334155' }}>
                          <strong>Work Performed:</strong> {order.technicianFeedback.workPerformed}
                        </div>
                      )}
                      {order.technicianFeedback.followUpNeeded && (
                        <div style={{ fontSize: 12, color: '#b45309' }}>
                          <strong>Follow-up Needed:</strong> {order.technicianFeedback.followUpNeeded}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manager Review Notes if reviewed */}
                  {order.reviewNotes && (
                    <div style={{
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: 6,
                      padding: '8px 12px',
                      marginBottom: 10,
                      fontSize: 12,
                      color: '#047857'
                    }}>
                      <strong>Manager Closure Review ({order.reviewedById?.fullName || 'Manager'}):</strong> {order.reviewNotes}
                    </div>
                  )}

                  {/* Audit Trail Timeline */}
                  <div style={{ borderTop: '1px solid #ede9f6', paddingTop: 8 }}>
                    <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Audit History:</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      {(order.statusHistory || []).map((h, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#64748b' }}>
                          • {new Date(h.timestamp).toLocaleTimeString()} ({new Date(h.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}):{' '}
                          <strong style={{ color: '#f8fafc' }}>{h.status?.toUpperCase()}</strong> by {h.changedByName} ({h.changedByRole})
                          {h.note && ` — "${h.note}"`}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ================= TAB 3: Sensor Channels & Model Compatibility ================= */}
      {activeTab === 'sensors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            title="Supported Transducer Signals"
            subtitle="Configured physical channels, sampling intervals, and model feature pipelines"
          >
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Signal Name</th>
                    <th scope="col">Standard Unit</th>
                    <th scope="col">Sampling Interval</th>
                    <th scope="col">Transducer Channel Key</th>
                    <th scope="col">Used By Models</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((sig) => {
                    const interval = sig.category === 'vibration' ? '100 ms (10 Hz)' : sig.category === 'thermal' ? '1 s (1 Hz)' : '10 s';
                    const usedBy = sig.category === 'vibration' ? 'Random Forest (GB-104) & Isolation Forest' : sig.category === 'thermal' ? 'Thermal Anomaly Detector & Multi-Signal Fusion' : 'Regime Normalization';
                    return (
                      <tr key={sig.key}>
                        <td className="table-primary-text">{sig.label}</td>
                        <td><span className="mono-code">{sig.unit}</span></td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{interval}</span></td>
                        <td><span className="mono-code">{sig.key}</span></td>
                        <td>
                          <span className={`category-tag category-${sig.category}`}>
                            {usedBy}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Compatible Models & Domain Separation Notice (UX Pilot Page 1) */}
          <Card
            title="Compatible Predictive Models"
            subtitle="Validated AI model artifacts compatible with this machine type"
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>GB-104 Supervised Classifier</strong>
                  <span className="badge badge-healthy" style={{ fontSize: '0.68rem' }}>COMPATIBLE</span>
                </div>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Random Forest ensemble (100 estimators) trained on helical-planetary simulator telemetry. Predicts healthy vs tooth wear/chipping vs crack.
                </p>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                  Held-out Test Macro F1: 0.985 • Explainer: Exact TreeSHAP
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>Unsupervised Isolation Forest</strong>
                  <span className="badge badge-healthy" style={{ fontSize: '0.68rem' }}>COMPATIBLE</span>
                </div>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Unsupervised outlier scoring across vibration RMS, crest factor, and kurtosis. Calibrated threshold: 0.55.
                </p>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                  Outlier Contamination: 0.05 • Non-diagnostic statistical scoring
                </div>
              </div>
            </div>

            <div className="hero-limitation-box">
              <Icon name="shield" size={16} color="#7c3aed" />
              <div>
                <strong>Machine Domain Separation Notice:</strong>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem' }}>
                  CWRU Bearing Classifier (3 HP load split) and NASA IMS Bearing Degradation models are bearing-specific reference models. They are restricted to bearing experiments and <strong>cannot</strong> be run against gearbox assets.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ================= TAB 4: Field Notes & History ================= */}
      {activeTab === 'notes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Add Note Form */}
          {(isManager || isTechnician) && !isDecomm && (
            <Card title="Record Field Observation Note" subtitle="Submit physical findings or maintenance observations to this machine's permanent history">
              {noteSuccess && (
                <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: 10, borderRadius: 6, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={14} color="#16a34a" /> {noteSuccess}
                </div>
              )}
              {noteError && (
                <div className="login-error-alert" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="alert" size={14} color="#dc2626" />
                  <span>{noteError}</span>
                </div>
              )}
              <form onSubmit={handleAddNote} className="note-form">
                <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 220 }}>
                    <label className="form-label">Category:</label>
                    <select
                      className="form-select"
                      value={noteCategory}
                      onChange={(e) => setNoteCategory(e.target.value)}
                    >
                      <option value="Field Inspection">Field Inspection</option>
                      <option value="Lubrication">Lubrication Service</option>
                      <option value="Bearing Condition">Bearing Condition</option>
                      <option value="Acoustic Observation">Acoustic Observation</option>
                      <option value="Vibration Sensor Check">Sensor Check</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Observation Details:</label>
                    <input
                      type="text"
                      className="form-select"
                      placeholder="e.g. Replenished 250ml synthetic gear oil; inspected sight glass"
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <Button type="submit" variant="primary" size="sm">
                  Log Field Note
                </Button>
              </form>
            </Card>
          )}

          {/* Notes History */}
          <Card title="Permanent Maintenance History Log" subtitle="Audited event ledger recording commissioning, work orders, and field notes">
            {notes.length === 0 ? (
              <p className="text-secondary">No maintenance notes recorded yet for this gearbox.</p>
            ) : (
              <div className="notes-list">
                {notes.map((note, index) => (
                  <div key={note._id || index} className="note-item">
                    <div className="note-header">
                      <span className="note-author">{note.author}</span>
                      <span className="note-category badge badge-info">{note.category}</span>
                      <span className="note-time">{new Date(note.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="note-content">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ================= TAB 5: Uploaded Datasets ================= */}
      {activeTab === 'datasets' && (
        <Card
          title="Machine Ingested Datasets"
          subtitle="Historical raw and preprocessed operational datasets uploaded for this gearbox"
          badge={
            !isDecomm && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate(ROUTES.DATASETS_UPLOAD)}
              >
                + Ingest New Dataset
              </Button>
            )
          }
        >
          {machineDatasets.length === 0 ? (
            <p className="text-secondary text-sm">No datasets uploaded yet for this gearbox specimen.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Title & Filename</th>
                    <th scope="col">Modality</th>
                    <th scope="col">Observations</th>
                    <th scope="col">Sampling Rate</th>
                    <th scope="col">Quality Status</th>
                    <th scope="col">Uploaded By</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {machineDatasets.map((ds) => (
                    <tr key={ds._id}>
                      <td>
                        <div className="table-primary-text" style={{ fontWeight: 600 }}>{ds.title}</div>
                        <span className="mono-code text-muted" style={{ fontSize: '0.75rem' }}>{ds.originalFilename}</span>
                      </td>
                      <td>
                        <span className="badge badge-site">{ds.modality}</span>
                      </td>
                      <td><span className="mono-code">{ds.totalRows?.toLocaleString()}</span></td>
                      <td><span className="mono-code">{ds.samplingRateHz ? `${ds.samplingRateHz} Hz` : 'Snapshot'}</span></td>
                      <td>
                        <StatusBadge
                          status={ds.status === 'ready' ? 'healthy' : ds.status === 'needs_review' ? 'warning' : 'critical'}
                          label={ds.status.toUpperCase()}
                        />
                      </td>
                      <td>
                        <span className="text-sm">{ds.uploadedByName}</span>
                        <div className="text-muted" style={{ fontSize: '0.75rem' }}>{new Date(ds.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                      </td>
                      <td>
                        <a
                          href={`${API_BASE}/datasets/${ds._id}/download`}
                          download
                          className="btn btn-secondary btn-sm"
                          style={{ textDecoration: 'none' }}
                        >
                          ⬇ CSV
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ================= MODAL: Create Work Order ================= */}
      {showCreateOrderModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h2 className="modal-title">Create Maintenance Work Order</h2>
              <button className="modal-close-btn" onClick={() => setShowCreateOrderModal(false)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            {orderFormError && (
              <div className="login-error-alert" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="alert" size={14} color="#dc2626" />
                <span>{orderFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateWorkOrder} className="modal-form">
              <div className="form-group">
                <label className="form-label">Work Order Title *</label>
                <input
                  type="text"
                  className="form-select"
                  placeholder="e.g. Inspect Planetary Stage Sun Pinion"
                  value={newOrder.title}
                  onChange={(e) => setNewOrder({ ...newOrder, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Task Description & Instructions *</label>
                <textarea
                  className="form-select"
                  rows={3}
                  placeholder="Specific inspection or repair instructions for the assigned technician"
                  value={newOrder.description}
                  onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Priority Level *</label>
                  <select
                    className="form-select"
                    value={newOrder.priority}
                    onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value })}
                  >
                    <option value={WORK_ORDER_PRIORITY.LOW}>Low</option>
                    <option value={WORK_ORDER_PRIORITY.MEDIUM}>Medium</option>
                    <option value={WORK_ORDER_PRIORITY.HIGH}>High</option>
                    <option value={WORK_ORDER_PRIORITY.URGENT}>Urgent</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Due Date *</label>
                  <input
                    type="date"
                    className="form-select"
                    value={newOrder.dueDate}
                    onChange={(e) => setNewOrder({ ...newOrder, dueDate: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assign Field Technician *</label>
                {assignedTechs.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="alert" size={14} color="#dc2626" /> No technicians are currently assigned to this machine. You must assign a technician to the machine before assigning work orders.
                  </p>
                ) : (
                  <select
                    className="form-select"
                    value={newOrder.assignedTechnicianId}
                    onChange={(e) => setNewOrder({ ...newOrder, assignedTechnicianId: e.target.value })}
                    required
                  >
                    {assignedTechs.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.fullName} ({t.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowCreateOrderModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={orderSubmitting} disabled={assignedTechs.length === 0}>
                  Issue Work Order
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: Complete Work Order ================= */}
      {showCompleteOrderModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h2 className="modal-title">Complete Work Order: {showCompleteOrderModal.orderNumber}</h2>
              <button className="modal-close-btn" onClick={() => setShowCompleteOrderModal(null)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateOrderStatus(showCompleteOrderModal._id, WORK_ORDER_STATUS.COMPLETED, completionFeedback);
            }} className="modal-form">
              <div className="form-group">
                <label className="form-label">Inspection Findings *</label>
                <textarea
                  className="form-select"
                  rows={2}
                  placeholder="Observed conditions (e.g. backlash, seal weeping, acoustic emission)"
                  value={completionFeedback.findings}
                  onChange={(e) => setCompletionFeedback({ ...completionFeedback, findings: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Work Performed *</label>
                <textarea
                  className="form-select"
                  rows={2}
                  placeholder="Actions taken (e.g. torqued bolts, replenished 250ml synthetic oil)"
                  value={completionFeedback.workPerformed}
                  onChange={(e) => setCompletionFeedback({ ...completionFeedback, workPerformed: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Follow-up Needed (Optional)</label>
                <input
                  type="text"
                  className="form-select"
                  placeholder="e.g. Order replacement labyrinth seal kit for next maintenance cycle"
                  value={completionFeedback.followUpNeeded}
                  onChange={(e) => setCompletionFeedback({ ...completionFeedback, followUpNeeded: e.target.value })}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowCompleteOrderModal(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Submit & Complete Work Order
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: Review Work Order (Manager) ================= */}
      {showReviewOrderModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2 className="modal-title">Manager Review & Closure</h2>
              <button className="modal-close-btn" onClick={() => setShowReviewOrderModal(null)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 12px' }}>
              Final review for <strong>{showReviewOrderModal.orderNumber}</strong> ({showReviewOrderModal.title}). Review technician findings and close out work order.
            </p>

            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateOrderStatus(showReviewOrderModal._id, WORK_ORDER_STATUS.REVIEWED, { note: reviewNote });
            }} className="modal-form">
              <div className="form-group">
                <label className="form-label">Manager Review Notes</label>
                <textarea
                  className="form-select"
                  rows={3}
                  placeholder="e.g. Findings confirmed. Oil change logged in mechanical asset registry."
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowReviewOrderModal(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Confirm Review & Close Task
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: Decommission Machine ================= */}
      {showDecommissionModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#dc2626' }}>Soft-Decommission Gearbox</h2>
              <button className="modal-close-btn" onClick={() => setShowDecommissionModal(false)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 12px' }}>
              Are you sure you want to soft-decommission <strong>{machineId} ({machine.name})</strong>?
              Historical telemetry and notes will remain intact, but this machine will be unavailable for new operational datasets or work orders.
            </p>

            <div className="form-group">
              <label className="form-label">Decommission Reason *</label>
              <textarea
                className="form-select"
                rows={3}
                placeholder="e.g. Replaced by high-efficiency planetary drive; archived for audit records"
                value={decommissionReason}
                onChange={(e) => setDecommissionReason(e.target.value)}
                required
              />
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <Button type="button" variant="secondary" onClick={() => setShowDecommissionModal(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleDecommission}
                disabled={!decommissionReason.trim()}
                style={{ backgroundColor: '#be123c', borderColor: '#9f1239' }}
              >
                Confirm Soft Decommission
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
