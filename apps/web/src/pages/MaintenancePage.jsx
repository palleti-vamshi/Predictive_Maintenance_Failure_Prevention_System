import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';
import Button from '../components/common/Button.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter, ROUTES } from '../router/Router.jsx';
import {
  WORK_ORDER_STATUS,
  WORK_ORDER_PRIORITY,
  USER_ROLES
} from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function MaintenancePage() {
  const { user } = useAuth();
  const { queryParams, navigate } = useRouter();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;
  const isTech = user?.role === USER_ROLES.TECHNICIAN;

  const [workOrders, setWorkOrders] = useState([]);
  const [eligibleTechs, setEligibleTechs] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Tab State: Manager uses ('board' | 'create' | 'requests' | 'history'), Technician uses ('my_work' | 'all')
  const [activeTab, setActiveTab] = useState(isTech ? 'my_work' : (queryParams?.action === 'create' ? 'create' : 'board'));
  const [techSubTab, setTechSubTab] = useState('todo'); // 'todo' | 'in_progress' | 'waiting' | 'submitted'
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // Modals state
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showExecutionModal, setShowExecutionModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [showClarificationModal, setShowClarificationModal] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState({});

  // Technician Execution Modal Form State (UX Pilot Page 6)
  const [executionChecklist, setExecutionChecklist] = useState({
    lotoConfirmed: true,
    baselineVibMeasured: false,
    gearBacklashChecked: false,
    oilSampleCollected: false
  });
  const [executionReadings, setExecutionReadings] = useState({
    vibrationRms: '',
    oilTemperature: '',
    oilSampleTaken: false
  });
  const [executionFindings, setExecutionFindings] = useState('');
  const [executionWorkDone, setExecutionWorkDone] = useState('');
  const [executionFollowUp, setExecutionFollowUp] = useState('');
  const [executionPhotoAttached, setExecutionPhotoAttached] = useState(false);
  const [executionShowHelpRequest, setExecutionShowHelpRequest] = useState(false);
  const [executionHelpType, setExecutionHelpType] = useState('parts');
  const [executionHelpReason, setExecutionHelpReason] = useState('');

  // Manager Decision Form State
  const [decisionType, setDecisionType] = useState('approved');
  const [decisionNote, setDecisionNote] = useState('');
  const [clarificationNote, setClarificationNote] = useState('');
  const [partsReason, setPartsReason] = useState('');
  const [permissionReason, setPermissionReason] = useState('');
  const [reassignTechId, setReassignTechId] = useState('');

  // New Work Order Form State (UX Pilot Page 7)
  const [newOrder, setNewOrder] = useState({
    machineCode: '',
    title: '',
    description: '',
    priority: WORK_ORDER_PRIORITY.HIGH,
    dueDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    assignedTechnicianId: '',
    sourceAlertId: '',
    sourceAnalysisRunId: '',
    instructions: [
      'Lock-out tag-out (LOTO) machine at MCC-2 switchgear.',
      'Record baseline vibration RMS at DE & NDE bearing positions.',
      'Inspect gear tooth contact pattern and intermediate shaft backlash.',
      'Draw 100 ml lubricant sample for spectrographic analysis.'
    ]
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = { Accept: 'application/json' };
      const [ordersRes, techsRes, machinesRes] = await Promise.all([
        fetch(`${API_BASE}/work-orders`, { credentials: 'include', headers }),
        isManager ? fetch(`${API_BASE}/work-orders/eligible-technicians`, { credentials: 'include', headers }) : Promise.resolve(null),
        isManager ? fetch(`${API_BASE}/machines`, { credentials: 'include', headers }) : Promise.resolve(null)
      ]);

      if (!ordersRes.ok) throw new Error('Failed to fetch maintenance work orders.');
      const ordersData = await ordersRes.json();
      setWorkOrders(ordersData.workOrders || []);

      if (techsRes && techsRes.ok) {
        const techsData = await techsRes.json();
        const tList = techsData.technicians || [];
        setEligibleTechs(tList);
        if (tList.length > 0 && !newOrder.assignedTechnicianId) {
          setNewOrder((prev) => ({ ...prev, assignedTechnicianId: tList[0]._id }));
        }
      }

      if (machinesRes && machinesRes.ok) {
        const machinesData = await machinesRes.json();
        const mList = machinesData.machines || [];
        setMachines(mList);
        if (mList.length > 0 && !newOrder.machineCode) {
          setNewOrder((prev) => ({ ...prev, machineCode: mList[0].code }));
        }
      }
    } catch (err) {
      console.error('[MaintenancePage:fetchData] Error:', err);
      setError(err.message || 'Error loading work orders.');
    } finally {
      setLoading(false);
    }
  }, [isManager, newOrder.assignedTechnicianId, newOrder.machineCode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle URL Query Params
  useEffect(() => {
    if (queryParams?.status) {
      if (['board', 'create', 'requests', 'history'].includes(queryParams.status)) {
        setActiveTab(queryParams.status);
      } else if (['todo', 'in_progress', 'waiting', 'submitted'].includes(queryParams.status)) {
        setActiveTab('my_work');
        setTechSubTab(queryParams.status);
      }
    }

    if (queryParams?.action === 'create' && isManager) {
      setActiveTab('create');
      if (queryParams.machineId && machines.length > 0) {
        const target = machines.find((m) => m._id === queryParams.machineId || m.code === queryParams.machineId);
        if (target) {
          setNewOrder((prev) => ({
            ...prev,
            machineCode: target.code,
            title: queryParams.analysisRunId
              ? `Investigate Anomaly Cluster on ${target.code}`
              : queryParams.alertId
              ? `Remediation: Warning Alert on ${target.code}`
              : prev.title,
            description: queryParams.analysisRunId
              ? `Triggered by analysis run ${queryParams.analysisRunId}${queryParams.interval ? ` (Interval #${queryParams.interval})` : ''}. Inspect gear teeth, verify transducer mounting, and record baseline RMS.`
              : queryParams.alertId
              ? `Direct remediation for alert ${queryParams.alertId}. Inspect physical components, log observations, and report findings.`
              : prev.description,
            sourceAlertId: queryParams.alertId || prev.sourceAlertId,
            sourceAnalysisRunId: queryParams.analysisRunId || prev.sourceAnalysisRunId
          }));
        }
      }
    } else if (queryParams?.machineId) {
      setSearchQuery(queryParams.machineId);
    }
  }, [queryParams, machines, isManager]);

  // KPI Metrics Calculation
  const metrics = useMemo(() => {
    const total = workOrders.length;
    const inProgress = workOrders.filter((o) =>
      [WORK_ORDER_STATUS.IN_PROGRESS, WORK_ORDER_STATUS.ASSIGNED, WORK_ORDER_STATUS.ACCEPTED].includes(o.status)
    ).length;
    const actionNeeded = workOrders.filter((o) =>
      [WORK_ORDER_STATUS.WAITING_FOR_PARTS, WORK_ORDER_STATUS.WAITING_FOR_APPROVAL].includes(o.status)
    ).length;
    const reviewPending = workOrders.filter((o) =>
      [WORK_ORDER_STATUS.WORK_SUBMITTED, WORK_ORDER_STATUS.MANAGER_REVIEW].includes(o.status)
    ).length;
    const completed = workOrders.filter((o) =>
      [WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(o.status)
    ).length;

    // Technician personal counts
    const myOrders = workOrders.filter(
      (o) => (o.assignedTechnicianId?._id || o.assignedTechnicianId)?.toString() === user?._id?.toString()
    );
    const myTodo = myOrders.filter((o) => [WORK_ORDER_STATUS.OPEN, WORK_ORDER_STATUS.ASSIGNED].includes(o.status)).length;
    const myInProgress = myOrders.filter((o) => o.status === WORK_ORDER_STATUS.IN_PROGRESS).length;
    const myWaiting = myOrders.filter((o) =>
      [WORK_ORDER_STATUS.WAITING_FOR_PARTS, WORK_ORDER_STATUS.WAITING_FOR_APPROVAL].includes(o.status)
    ).length;
    const mySubmitted = myOrders.filter((o) =>
      [WORK_ORDER_STATUS.WORK_SUBMITTED, WORK_ORDER_STATUS.MANAGER_REVIEW].includes(o.status)
    ).length;

    return { total, inProgress, actionNeeded, reviewPending, completed, myOrders: myOrders.length, myTodo, myInProgress, myWaiting, mySubmitted };
  }, [workOrders, user?._id]);

  // Tab Filtering for Orders
  const displayedOrders = useMemo(() => {
    return workOrders.filter((order) => {
      // Role & Tab filter
      if (isTech && activeTab === 'my_work') {
        const techId = (order.assignedTechnicianId?._id || order.assignedTechnicianId)?.toString();
        if (techId !== user?._id?.toString()) return false;

        if (techSubTab === 'todo') {
          if (![WORK_ORDER_STATUS.OPEN, WORK_ORDER_STATUS.ASSIGNED].includes(order.status)) return false;
        } else if (techSubTab === 'in_progress') {
          if (order.status !== WORK_ORDER_STATUS.IN_PROGRESS) return false;
        } else if (techSubTab === 'waiting') {
          if (![WORK_ORDER_STATUS.WAITING_FOR_PARTS, WORK_ORDER_STATUS.WAITING_FOR_APPROVAL].includes(order.status)) return false;
        } else if (techSubTab === 'submitted') {
          if (![WORK_ORDER_STATUS.WORK_SUBMITTED, WORK_ORDER_STATUS.MANAGER_REVIEW, WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(order.status)) return false;
        }
      } else if (isManager) {
        if (activeTab === 'board') {
          if ([WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(order.status)) return false;
        } else if (activeTab === 'requests') {
          const hasApproval = order.approvalRequest && order.approvalRequest.status === 'pending';
          const isSubmitted = [WORK_ORDER_STATUS.WORK_SUBMITTED, WORK_ORDER_STATUS.MANAGER_REVIEW].includes(order.status);
          if (!hasApproval && !isSubmitted) return false;
        } else if (activeTab === 'history') {
          if (![WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(order.status)) return false;
        }
      }

      // Priority Filter
      if (priorityFilter !== 'all' && order.priority !== priorityFilter) return false;

      // Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const num = order.orderNumber?.toLowerCase() || '';
        const title = order.title?.toLowerCase() || '';
        const code = order.machineId?.code?.toLowerCase() || '';
        const desc = order.description?.toLowerCase() || '';
        if (!num.includes(q) && !title.includes(q) && !code.includes(q) && !desc.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [workOrders, activeTab, techSubTab, priorityFilter, searchQuery, isTech, isManager, user?._id]);

  // Open Job Details Modal (UX Pilot Page 6)
  const openExecutionModal = (order) => {
    setSelectedOrder(order);
    setExecutionFindings(order.technicianFeedback?.findings || '');
    setExecutionWorkDone(order.technicianFeedback?.workPerformed || '');
    setExecutionFollowUp(order.technicianFeedback?.followUpNeeded || '');
    setExecutionReadings({
      vibrationRms: '4.8',
      oilTemperature: '58.5',
      oilSampleTaken: true
    });
    setExecutionChecklist({
      lotoConfirmed: true,
      baselineVibMeasured: order.status === WORK_ORDER_STATUS.IN_PROGRESS,
      gearBacklashChecked: false,
      oilSampleCollected: false
    });
    setExecutionPhotoAttached(false);
    setExecutionShowHelpRequest(false);
    setShowExecutionModal(true);
  };

  // Status Change (PATCH status)
  const handleUpdateStatus = async (orderId, newStatus, note) => {
    try {
      const res = await fetch(`${API_BASE}/work-orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          note: note || `Status transitioned to ${newStatus}`
        })
      });
      if (!res.ok) throw new Error('Failed to update status.');
      setActionSuccess(`Work order status updated to ${newStatus.replace(/_/g, ' ').toUpperCase()}.`);
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
      if (selectedOrder && selectedOrder._id === orderId) {
        setSelectedOrder((prev) => ({ ...prev, status: newStatus }));
      }
    } catch (err) {
      alert(err.message);
    }
  };

  // Submit Work Report from Modal
  const handleSubmitExecutionReport = async (e) => {
    e.preventDefault();
    if (!selectedOrder) return;

    try {
      // If technician also filled in field readings, prepend to workPerformed
      const readingsSummary = `[Field Telemetry Verification] Vibration RMS: ${executionReadings.vibrationRms || '4.8'} mm/s | Oil Temp: ${executionReadings.oilTemperature || '58.5'} °C | Lubricant Sample: ${executionReadings.oilSampleTaken ? 'Collected & Labelled' : 'Not collected'}. Checklist: ${Object.values(executionChecklist).filter(Boolean).length}/4 verified.`;
      const fullWorkPerformed = `${readingsSummary}\n${executionWorkDone.trim() || 'Executed complete physical inspection and calibration check.'}`;

      const res = await fetch(`${API_BASE}/work-orders/${selectedOrder._id}/submit-work`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          findings: executionFindings.trim() || 'No severe mechanical damage observed. Minor backlash within tolerance.',
          workPerformed: fullWorkPerformed,
          followUpNeeded: executionFollowUp.trim() || 'Recheck oil level at next 500 operating hours.'
        })
      });
      if (!res.ok) throw new Error('Failed to submit work report.');
      setShowExecutionModal(false);
      setActionSuccess('Work report submitted to Plant Manager for review.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Submit Quick Help Request from within Job Details Modal
  const handleQuickHelpSubmit = async (e) => {
    e.preventDefault();
    if (!executionHelpReason.trim() || !selectedOrder) return;
    try {
      const endpoint = executionHelpType === 'parts' ? 'request-parts' : 'request-approval';
      const res = await fetch(`${API_BASE}/work-orders/${selectedOrder._id}/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason: executionHelpReason.trim() })
      });
      if (!res.ok) throw new Error('Failed to submit request.');
      setExecutionHelpReason('');
      setExecutionShowHelpRequest(false);
      setActionSuccess(`${executionHelpType === 'parts' ? 'Parts' : 'Permission'} request submitted to manager.`);
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Manager Decision on Pending Request
  const handleDecisionSubmit = async (e) => {
    e.preventDefault();
    if (!selectedOrder) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${selectedOrder._id}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          decision: decisionType,
          decisionNote: decisionNote.trim() || (decisionType === 'approved' ? 'Request approved by Plant Manager.' : 'Request declined.')
        })
      });
      if (!res.ok) throw new Error('Failed to submit decision.');
      setShowDecisionModal(false);
      setDecisionNote('');
      setSelectedOrder(null);
      setActionSuccess(`Request ${decisionType.toUpperCase()} and work order updated.`);
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Manager Final Sign-off
  const handleManagerComplete = async (orderId) => {
    if (!window.confirm('Approve and close this maintenance work order? This records permanent closure in the machine ledger.')) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          status: WORK_ORDER_STATUS.REVIEWED,
          note: 'Work verified, findings signed off, and order closed by Plant Manager.'
        })
      });
      if (!res.ok) throw new Error('Failed to complete work order.');
      setActionSuccess('Work order verified and closed in permanent ledger.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Manager Clarification Return
  const handleClarificationSubmit = async (e) => {
    e.preventDefault();
    if (!clarificationNote.trim() || !selectedOrder) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${selectedOrder._id}/return-clarification`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clarificationNote: clarificationNote.trim() })
      });
      if (!res.ok) throw new Error('Failed to return work order.');
      setShowClarificationModal(false);
      setClarificationNote('');
      setSelectedOrder(null);
      setActionSuccess('Work order returned to technician with clarification notice.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Manager Create Work Order (UX Pilot Page 7)
  const handleCreateOrderSubmit = async (e) => {
    e.preventDefault();
    if (!newOrder.machineCode || !newOrder.title.trim() || !newOrder.assignedTechnicianId) {
      alert('Please select a machine, title, and assigned technician.');
      return;
    }
    try {
      const fullDescription = `${newOrder.description.trim()}\n\nStandard Work Instructions:\n${newOrder.instructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}`;

      const res = await fetch(`${API_BASE}/machines/${newOrder.machineCode}/work-orders`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          title: newOrder.title.trim(),
          description: fullDescription,
          priority: newOrder.priority,
          dueDate: newOrder.dueDate,
          assignedTechnicianId: newOrder.assignedTechnicianId,
          sourceAlertId: newOrder.sourceAlertId || null,
          sourceAnalysisRunId: newOrder.sourceAnalysisRunId || null
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to create work order.');
      }
      setActionSuccess(`Work order successfully created and assigned to ${eligibleTechs.find((t) => t._id === newOrder.assignedTechnicianId)?.fullName || 'technician'}.`);
      setTimeout(() => setActionSuccess(null), 4000);
      setActiveTab('board');
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleHistory = (orderId) => {
    setExpandedHistory((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const selectedTech = eligibleTechs.find((t) => t._id === newOrder.assignedTechnicianId);

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-demo">DEMO DATA</span>
            <span className="badge badge-operational">MECHGUARD AI WORKFLOW</span>
          </div>
          <h1 className="page-title">
            {isTech ? 'My Maintenance Work' : 'Maintenance & Work Order Operations'}
          </h1>
          <p className="page-subtitle">
            {isTech
              ? `${user?.fullName} · Shift A · ${user?.factoryId?.name || 'Pune Plant #2'} · Field inspection execution and evidence reporting.`
              : 'Workload-aware technician dispatch, evidence-based remediation, parts authorization, and manager sign-off.'}
          </p>
        </div>

        {isManager && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {activeTab !== 'create' ? (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => setActiveTab('create')}
              >
                New Work Order
              </Button>
            ) : (
              <Button
                variant="outline"
                icon="arrowRight"
                onClick={() => setActiveTab('board')}
              >
                Back to Work Board
              </Button>
            )}
          </div>
        )}
      </div>

      {actionSuccess && (
        <AlertCallout
          severity="low"
          title="Operation Confirmed"
          description={actionSuccess}
        />
      )}

      {/* KPI Metrics Summary Bar */}
      <div className="metrics-grid" style={{ marginBottom: '1.5rem' }}>
        {isManager ? (
          <>
            <MetricSummary
              label="Fleet Work Orders"
              value={metrics.total}
              change="Active factory tasks"
              changeType="neutral"
              icon="wrench"
            />
            <MetricSummary
              label="In Progress"
              value={metrics.inProgress}
              change="Field execution active"
              changeType="neutral"
              icon="clock"
            />
            <MetricSummary
              label="Awaiting Manager Review"
              value={metrics.actionNeeded + metrics.reviewPending}
              change={`${metrics.actionNeeded} parts/approval • ${metrics.reviewPending} reports`}
              changeType={(metrics.actionNeeded + metrics.reviewPending) > 0 ? 'warning' : 'neutral'}
              icon="alert"
            />
            <MetricSummary
              label="Closed & Verified"
              value={metrics.completed}
              change="Signed off in ledger"
              changeType="positive"
              icon="check"
            />
          </>
        ) : (
          <>
            <MetricSummary
              label="My Assigned Tasks"
              value={metrics.myOrders}
              change="Current shift backlog"
              changeType="neutral"
              icon="wrench"
            />
            <MetricSummary
              label="To Do"
              value={metrics.myTodo}
              change="Ready for commencement"
              changeType={metrics.myTodo > 0 ? 'warning' : 'neutral'}
              icon="clock"
            />
            <MetricSummary
              label="In Progress"
              value={metrics.myInProgress}
              change="Currently executing"
              changeType="neutral"
              icon="activity"
            />
            <MetricSummary
              label="Submitted Reports"
              value={metrics.mySubmitted}
              change="Pending manager approval"
              changeType="positive"
              icon="check"
            />
          </>
        )}
      </div>

      {/* Top Navigation Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {isManager ? (
            <React.Fragment key="mgr-tabs">
              <button
                key="tab-board"
                type="button"
                className={`filter-pill-btn ${activeTab === 'board' ? 'active' : ''}`}
                onClick={() => setActiveTab('board')}
              >
                Work Board ({workOrders.filter((o) => ![WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(o.status)).length})
              </button>
              <button
                key="tab-create"
                type="button"
                className={`filter-pill-btn ${activeTab === 'create' ? 'active' : ''}`}
                onClick={() => setActiveTab('create')}
              >
                Create & Assign
              </button>
              <button
                key="tab-requests"
                type="button"
                className={`filter-pill-btn ${activeTab === 'requests' ? 'active' : ''}`}
                onClick={() => setActiveTab('requests')}
              >
                Requests Awaiting Review ({metrics.actionNeeded + metrics.reviewPending})
              </button>
              <button
                key="tab-history"
                type="button"
                className={`filter-pill-btn ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                Maintenance History ({metrics.completed})
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment key="tech-tabs">
              <button
                key="tab-mywork"
                type="button"
                className={`filter-pill-btn ${activeTab === 'my_work' ? 'active' : ''}`}
                onClick={() => setActiveTab('my_work')}
              >
                My Work ({metrics.myOrders})
              </button>
              <button
                key="tab-all"
                type="button"
                className={`filter-pill-btn ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                All Plant Orders ({workOrders.length})
              </button>
            </React.Fragment>
          )}
        </div>

        {/* Search & Priority Controls (when not in create tab) */}
        {activeTab !== 'create' && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search order, machine, title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input"
                style={{ paddingLeft: '2rem', width: '230px' }}
              />
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}>
                <Icon name="filter" size={13} color="var(--text-tertiary)" />
              </span>
            </div>

            <select
              className="form-select"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="all">All Priorities</option>
              <option value={WORK_ORDER_PRIORITY.CRITICAL}>Critical</option>
              <option value={WORK_ORDER_PRIORITY.HIGH}>High</option>
              <option value={WORK_ORDER_PRIORITY.MEDIUM}>Medium</option>
              <option value={WORK_ORDER_PRIORITY.LOW}>Low</option>
            </select>
          </div>
        )}
      </div>

      {/* Technician Sub-tabs (UX Pilot Page 5: To do, In progress, Waiting, Submitted) */}
      {isTech && activeTab === 'my_work' && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
          <button
            key="subtab-todo"
            type="button"
            className={`tab-btn ${techSubTab === 'todo' ? 'tab-btn-active' : ''}`}
            onClick={() => setTechSubTab('todo')}
          >
            To Do ({metrics.myTodo})
          </button>
          <button
            key="subtab-in_progress"
            type="button"
            className={`tab-btn ${techSubTab === 'in_progress' ? 'tab-btn-active' : ''}`}
            onClick={() => setTechSubTab('in_progress')}
          >
            In Progress ({metrics.myInProgress})
          </button>
          <button
            key="subtab-waiting"
            type="button"
            className={`tab-btn ${techSubTab === 'waiting' ? 'tab-btn-active' : ''}`}
            onClick={() => setTechSubTab('waiting')}
          >
            Waiting for Approval ({metrics.myWaiting})
          </button>
          <button
            key="subtab-submitted"
            type="button"
            className={`tab-btn ${techSubTab === 'submitted' ? 'tab-btn-active' : ''}`}
            onClick={() => setTechSubTab('submitted')}
          >
            Submitted & Closed ({metrics.mySubmitted})
          </button>
        </div>
      )}

      {/* VIEW 1: CREATE & ASSIGN WORK ORDER (UX Pilot Page 7) */}
      {isManager && activeTab === 'create' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {newOrder.sourceAlertId && (
            <div className="job-card-why" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#b45309' }}>
                  <Icon name="alert" size={15} color="#b45309" />
                  Originating Alert Evidence: {newOrder.sourceAlertId}
                </strong>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#92400e' }}>
                  3 consecutive windows above anomaly threshold (0.68 vs 0.55). Radial vibration RMS elevated. Pre-filling work order parameters.
                </p>
              </div>
              <span className="badge badge-warning">HIGH ALERT</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {/* Left Column: Scope & Requirements */}
            <Card title="1. Task Scope & Instructions" subtitle="Define physical inspection protocol and safety prerequisites.">
              <form onSubmit={handleCreateOrderSubmit} id="create-order-form">
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Target Machine</label>
                  <select
                    className="form-select"
                    value={newOrder.machineCode}
                    onChange={(e) => setNewOrder({ ...newOrder, machineCode: e.target.value })}
                    required
                  >
                    {machines.map((m) => (
                      <option key={m._id} value={m.code}>
                        {m.code} — {m.name} ({m.type || 'Gearbox'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Work Order Title</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Investigate severe radial vibration on GBX-01 intermediate shaft"
                    value={newOrder.title}
                    onChange={(e) => setNewOrder({ ...newOrder, title: e.target.value })}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Priority Level</label>
                    <div className="segmented-control" style={{ width: '100%' }}>
                      {[WORK_ORDER_PRIORITY.CRITICAL, WORK_ORDER_PRIORITY.HIGH, WORK_ORDER_PRIORITY.MEDIUM, WORK_ORDER_PRIORITY.LOW].map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`segmented-btn ${newOrder.priority === p ? 'active' : ''}`}
                          style={{ flex: 1, textTransform: 'capitalize' }}
                          onClick={() => setNewOrder({ ...newOrder, priority: p })}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Due Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={newOrder.dueDate}
                      onChange={(e) => setNewOrder({ ...newOrder, dueDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Work Scope & Context</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Provide specific notes regarding anomalous sensor telemetry or physical symptoms."
                    value={newOrder.description}
                    onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                    required
                  />
                </div>

                {/* Work Instructions Checklist */}
                <div className="form-group">
                  <label className="form-label">Standard Work Instructions</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {newOrder.instructions.map((inst, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface-subtle)', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem' }}>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{idx + 1}.</span>
                        <span style={{ color: 'var(--text-primary)', flex: 1 }}>{inst}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </form>
            </Card>

            {/* Right Column: Workload-Aware Technician Ranking (UX Pilot Page 7) */}
            <Card title="2. Choose a Technician" subtitle="Candidates ranked by skill match, active workload, and shift availability.">
              <div style={{ overflowX: 'auto' }}>
                <table className="tech-candidate-table">
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th>Skills Match</th>
                      <th>Workload</th>
                      <th>Next Free</th>
                      <th>Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleTechs.map((tech) => {
                      const isSelected = newOrder.assignedTechnicianId === tech._id;
                      const activeCount = tech.activeWorkload ?? 0;
                      const skills = tech.skills || ['Vibration Analysis ISO II', 'Gearbox Overhaul'];

                      return (
                        <tr
                          key={tech._id}
                          className={`tech-candidate-row ${isSelected ? 'selected-row' : ''}`}
                          onClick={() => setNewOrder({ ...newOrder, assignedTechnicianId: tech._id })}
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                              <input
                                type="radio"
                                name="selectedTech"
                                checked={isSelected}
                                onChange={() => setNewOrder({ ...newOrder, assignedTechnicianId: tech._id })}
                                style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                              />
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {tech.fullName}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  {(tech.isDemoAccount || tech.email?.includes('.factory')) ? 'Demo Account • ' : ''}{tech.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                              {skills.slice(0, 2).map((s, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    fontSize: '0.68rem',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: '4px',
                                    background: '#ffffff',
                                    border: '1px solid var(--border-subtle)',
                                    color: 'var(--text-secondary)'
                                  }}
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${activeCount === 0 ? 'badge-healthy' : activeCount < 3 ? 'badge-operational' : 'badge-warning'}`}
                              style={{ fontSize: '0.7rem' }}
                            >
                              {activeCount} WO • ~{activeCount * 3} h
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {activeCount === 0 ? 'Today 14:00' : activeCount === 1 ? 'Today 16:30' : 'Tomorrow 09:00'}
                            </span>
                          </td>
                          <td>
                            <span className="badge badge-operational" style={{ fontSize: '0.68rem' }}>
                              Eligible
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <strong>Workload Calculation:</strong> Derived in real time from open factory work orders in MongoDB. Ensures no technician is overloaded beyond shift capacity.
              </div>
            </Card>
          </div>

          {/* Sticky Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '1rem 1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Action Summary: </span>
              <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                Assigning to {selectedTech?.fullName || 'Technician'} • {newOrder.priority.toUpperCase()} Priority • Due {new Date(newOrder.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </strong>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button
                variant="outline"
                type="button"
                onClick={() => setActiveTab('board')}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                icon="check"
                type="submit"
                form="create-order-form"
              >
                Create & Assign Work Order
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: WORK BOARD / MY WORK / REQUESTS / HISTORY (UX Pilot Page 1 & 5) */}
      {activeTab !== 'create' && (
        <>
          {loading ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                <p>Loading maintenance records from MongoDB ledger...</p>
              </div>
            </Card>
          ) : error ? (
            <AlertCallout
              severity="high"
              title="Error Loading Work Orders"
              description={error}
            />
          ) : displayedOrders.length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <Icon name="wrench" size={40} color="var(--primary-light)" />
                <h3 style={{ marginTop: '1rem', color: 'var(--text-primary)' }}>No Work Orders Found</h3>
                <p style={{ maxWidth: '420px', margin: '0.5rem auto 1.5rem auto' }}>
                  {searchQuery || priorityFilter !== 'all'
                    ? 'No maintenance records match your active search or priority filter.'
                    : activeTab === 'requests'
                    ? 'No pending parts requests or submitted work reports awaiting manager review.'
                    : 'There are currently no maintenance work orders in this view.'}
                </p>
                {isManager && activeTab !== 'requests' && (
                  <Button variant="primary" icon="plus" onClick={() => setActiveTab('create')}>
                    Create Work Order
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              {displayedOrders.map((order) => {
                const isAssignedToUser = (order.assignedTechnicianId?._id || order.assignedTechnicianId)?.toString() === user?._id?.toString();
                const isHistoryOpen = !!expandedHistory[order._id];
                const hasPendingApproval = order.approvalRequest && order.approvalRequest.status === 'pending';
                const isWorkSubmitted = [WORK_ORDER_STATUS.WORK_SUBMITTED, WORK_ORDER_STATUS.MANAGER_REVIEW].includes(order.status);
                const isCompleted = [WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(order.status);

                return (
                  <Card key={order._id} className="work-order-card">
                    {/* Header Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                          {order.orderNumber}
                        </span>
                        <span style={{ color: 'var(--border-subtle)' }}>•</span>
                        <a
                          href={`#/machines/${order.machineId?.code || ''}`}
                          style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          <Icon name="machine" size={14} color="var(--text-secondary)" />
                          {order.machineId?.code} ({order.machineId?.name || 'Gearbox'})
                        </a>
                        <span style={{ color: 'var(--border-subtle)' }}>•</span>
                        <span className={`priority-tag priority-${order.priority?.toLowerCase()}`}>
                          {order.priority?.toUpperCase()} PRIORITY
                        </span>
                      </div>

                      <StatusBadge
                        status={
                          isCompleted
                            ? 'healthy'
                            : hasPendingApproval || isWorkSubmitted
                            ? 'warning'
                            : 'operational'
                        }
                        label={order.status?.replace(/_/g, ' ')?.toUpperCase()}
                      />
                    </div>

                    {/* Title & Description */}
                    <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.4rem 0', color: 'var(--text-primary)' }}>
                      {order.title}
                    </h3>
                    <p style={{ margin: '0 0 0.85rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5 }}>
                      {order.description}
                    </p>

                    {/* UX Pilot Page 5: "Why this was raised" alert evidence callout */}
                    {order.sourceAlertId && (
                      <div className="job-card-why" style={{ marginBottom: '0.85rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, marginBottom: '0.2rem', color: '#b45309' }}>
                          <Icon name="alert" size={14} color="#b45309" />
                          <span>Why this was raised: Originating Alert {order.sourceAlertId?.title ? `(${order.sourceAlertId.title})` : ''}</span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                          Statistical anomaly cluster detected on radial vibration telemetry exceeding calibrated threshold (0.68 vs 0.55). Physical transducer verification mandated.
                        </div>
                      </div>
                    )}

                    {/* LOTO / Safety Tag Callout */}
                    <div className="loto-warning-box" style={{ marginBottom: '0.85rem' }}>
                      <Icon name="shield" size={15} color="#b45309" />
                      <span>LOTO Required: Lock-Out Tag-Out isolation at MCC-2 Switchgear before physical inspection.</span>
                    </div>

                    {/* Assigned Technician & Due Date Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--bg-surface-subtle)', borderRadius: '8px', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary-glow)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem' }}>
                          {order.assignedTechnicianId?.fullName?.substring(0, 2)?.toUpperCase() || 'TC'}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {order.assignedTechnicianId?.fullName || 'Assigned Technician'}
                            {(order.assignedTechnicianId?.isDemoAccount || order.assignedTechnicianId?.email?.includes('.factory')) && (
                              <span className="badge badge-demo" style={{ marginLeft: 6, fontSize: '0.65rem', padding: '1px 4px' }}>Demo</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                            {order.assignedTechnicianId?.email}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <div>
                          <span style={{ color: 'var(--text-tertiary)' }}>Due: </span>
                          <strong style={{ color: new Date(order.dueDate) < new Date() && !isCompleted ? '#dc2626' : 'var(--text-primary)' }}>
                            {new Date(order.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-tertiary)' }}>Est. Duration: </span>
                          <strong>2.5 hours</strong>
                        </div>
                      </div>
                    </div>

                    {/* Pending Request Banner */}
                    {hasPendingApproval && (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                          <strong style={{ color: '#b45309', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Icon name="clock" size={14} color="#b45309" />
                            {order.approvalRequest.requestType === 'parts' ? 'Parts Procurement Requested' : 'Manager Permission Requested'}
                          </strong>
                          <span style={{ fontSize: '0.75rem', color: '#92400e' }}>
                            {order.approvalRequest.requestedAt && !isNaN(new Date(order.approvalRequest.requestedAt).getTime())
                              ? `Requested ${new Date(order.approvalRequest.requestedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                              : 'Pending Review'}
                          </span>
                        </div>
                        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#78350f' }}>
                          <strong>Reason:</strong> {order.approvalRequest.reason}
                        </p>
                        {isManager && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <Button
                              variant="primary"
                              size="sm"
                              icon="check"
                              onClick={() => {
                                setSelectedOrder(order);
                                setDecisionType('approved');
                                setShowDecisionModal(true);
                              }}
                            >
                              Approve Request
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              icon="close"
                              onClick={() => {
                                setSelectedOrder(order);
                                setDecisionType('rejected');
                                setShowDecisionModal(true);
                              }}
                            >
                              Reject Request
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Submitted Work Report Banner */}
                    {isWorkSubmitted && order.technicianFeedback && (
                      <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--primary-light)', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <strong style={{ color: 'var(--primary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Icon name="file" size={14} color="var(--primary)" />
                            Technician Inspection & Telemetry Report Submitted
                          </strong>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                            {order.technicianFeedback.submittedAt ? new Date(order.technicianFeedback.submittedAt).toLocaleString() : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', display: 'grid', gap: '0.35rem', marginBottom: '0.75rem' }}>
                          <div><strong>Findings:</strong> {order.technicianFeedback.findings || 'No physical defects noted.'}</div>
                          <div><strong>Work Performed:</strong> {order.technicianFeedback.workPerformed || 'Inspection completed.'}</div>
                          {order.technicianFeedback.followUpNeeded && (
                            <div><strong>Follow-up Recommendation:</strong> {order.technicianFeedback.followUpNeeded}</div>
                          )}
                        </div>
                        {isManager && (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <Button
                              variant="primary"
                              size="sm"
                              icon="check"
                              onClick={() => handleManagerComplete(order._id)}
                            >
                              Approve & Close Work Order
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              icon="refresh"
                              onClick={() => {
                                setSelectedOrder(order);
                                setShowClarificationModal(true);
                              }}
                            >
                              Request Clarification
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {/* Technician View Buttons */}
                        {isTech && (
                          <React.Fragment key={`tech-actions-${order._id}`}>
                            {[WORK_ORDER_STATUS.OPEN, WORK_ORDER_STATUS.ASSIGNED].includes(order.status) && (
                              <Button
                                key={`start-${order._id}`}
                                variant="primary"
                                size="sm"
                                icon="play"
                                onClick={() => handleUpdateStatus(order._id, WORK_ORDER_STATUS.IN_PROGRESS, 'Technician accepted order and commenced field inspection.')}
                              >
                                Start Work
                              </Button>
                            )}
                            <Button
                              key={`details-${order._id}`}
                              variant={order.status === WORK_ORDER_STATUS.IN_PROGRESS ? 'primary' : 'outline'}
                              size="sm"
                              icon="wrench"
                              onClick={() => openExecutionModal(order)}
                            >
                              {order.status === WORK_ORDER_STATUS.IN_PROGRESS ? 'Continue & Record Telemetry' : 'Job Details & Checklist'}
                            </Button>
                          </React.Fragment>
                        )}

                        {/* Manager View Buttons */}
                        {isManager && (
                          <Button
                            key={`reassign-${order._id}`}
                            variant="secondary"
                            size="sm"
                            icon="user"
                            onClick={() => {
                              setSelectedOrder(order);
                              setReassignTechId(order.assignedTechnicianId?._id || '');
                              setShowAssignModal(true);
                            }}
                          >
                            Reassign Technician
                          </Button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleHistory(order._id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                      >
                        <Icon name="clock" size={13} color="var(--primary)" />
                        {isHistoryOpen ? 'Hide Audit History' : `Audit History (${order.statusHistory?.length || 0} events)`}
                        <Icon name={isHistoryOpen ? 'chevronDown' : 'arrowRight'} size={12} color="var(--primary)" />
                      </button>
                    </div>

                    {/* Collapsible Audit History Timeline */}
                    {isHistoryOpen && (
                      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed var(--border-subtle)' }}>
                        <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.75rem 0', color: 'var(--text-secondary)' }}>
                          Chronological Audit Trail & State Transitions
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          {order.statusHistory?.map((step, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.8rem' }}>
                              <div style={{ minWidth: '120px', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                                {new Date(step.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', marginTop: '4px' }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <strong style={{ color: 'var(--text-primary)' }}>{step.changedByName}</strong>
                                  <span style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem' }}>({step.changedByRole})</span>
                                  <span className="badge badge-operational" style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem' }}>
                                    {step.status?.replace(/_/g, ' ')?.toUpperCase()}
                                  </span>
                                </div>
                                {step.note && (
                                  <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                                    {step.note}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* MODAL: TECHNICIAN JOB DETAILS & EXECUTION (UX Pilot Page 6) */}
      {showExecutionModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                  {selectedOrder.orderNumber}
                </span>
                <h2 className="modal-title" style={{ fontSize: '1.15rem', marginTop: '0.15rem' }}>
                  {selectedOrder.machineId?.code} — Maintenance Execution
                </h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowExecutionModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Status Segmented Switcher */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0.75rem', background: 'var(--bg-surface-subtle)', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Active Execution Status:
              </span>
              <div className="segmented-control">
                {[WORK_ORDER_STATUS.ASSIGNED, WORK_ORDER_STATUS.IN_PROGRESS, WORK_ORDER_STATUS.WAITING_FOR_PARTS].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`segmented-btn ${selectedOrder.status === st ? 'active' : ''}`}
                    onClick={() => handleUpdateStatus(selectedOrder._id, st, `Technician updated status to ${st}`)}
                  >
                    {st === WORK_ORDER_STATUS.WAITING_FOR_PARTS ? 'On Hold' : st.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Originating Alert & Physical Inspection Disclaimer */}
            <div className="job-card-why" style={{ marginBottom: '1.25rem' }}>
              <strong>Originating Evidence & Physical Calibration Rule:</strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem' }}>
                Alert AL-318 triggered by statistical anomaly cluster (0.68 score vs 0.55 threshold). Physical inspection must verify transducer mounting and check intermediate shaft backlash before teardown.
              </p>
            </div>

            {/* Interactive 4-step Checklist */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Procedural Inspection Checklist ({Object.values(executionChecklist).filter(Boolean).length} of 4 verified)
              </label>
              <div className="interactive-checklist">
                <div
                  className={`checklist-row ${executionChecklist.lotoConfirmed ? 'checked-row' : ''}`}
                  onClick={() => setExecutionChecklist((p) => ({ ...p, lotoConfirmed: !p.lotoConfirmed }))}
                >
                  <input
                    type="checkbox"
                    checked={executionChecklist.lotoConfirmed}
                    onChange={() => {}}
                    style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  <span className="checklist-text">1. Lock-out tag-out (LOTO) confirmed at MCC-2 switchgear</span>
                </div>
                <div
                  className={`checklist-row ${executionChecklist.baselineVibMeasured ? 'checked-row' : ''}`}
                  onClick={() => setExecutionChecklist((p) => ({ ...p, baselineVibMeasured: !p.baselineVibMeasured }))}
                >
                  <input
                    type="checkbox"
                    checked={executionChecklist.baselineVibMeasured}
                    onChange={() => {}}
                    style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  <span className="checklist-text">2. Baseline vibration RMS measured at DE and NDE bearings</span>
                </div>
                <div
                  className={`checklist-row ${executionChecklist.gearBacklashChecked ? 'checked-row' : ''}`}
                  onClick={() => setExecutionChecklist((p) => ({ ...p, gearBacklashChecked: !p.gearBacklashChecked }))}
                >
                  <input
                    type="checkbox"
                    checked={executionChecklist.gearBacklashChecked}
                    onChange={() => {}}
                    style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  <span className="checklist-text">3. Inspect gear tooth contact pattern and backlash</span>
                </div>
                <div
                  className={`checklist-row ${executionChecklist.oilSampleCollected ? 'checked-row' : ''}`}
                  onClick={() => setExecutionChecklist((p) => ({ ...p, oilSampleCollected: !p.oilSampleCollected }))}
                >
                  <input
                    type="checkbox"
                    checked={executionChecklist.oilSampleCollected}
                    onChange={() => {}}
                    style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  <span className="checklist-text">4. Draw 100 ml lubricant sample for laboratory spectrographic testing</span>
                </div>
              </div>
            </div>

            {/* Field Readings Entry with Physical Units */}
            <div style={{ marginBottom: '1.25rem', background: 'var(--bg-surface-subtle)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <label className="form-label" style={{ marginBottom: '0.65rem', display: 'block' }}>
                Field Telemetry Measurements
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Radial Vibration RMS
                  </span>
                  <div className="unit-input-group">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 4.8"
                      value={executionReadings.vibrationRms}
                      onChange={(e) => setExecutionReadings({ ...executionReadings, vibrationRms: e.target.value })}
                    />
                    <span className="unit-input-addon">mm/s</span>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Sump Oil Temperature
                  </span>
                  <div className="unit-input-group">
                    <input
                      type="number"
                      step="0.5"
                      placeholder="e.g. 58.5"
                      value={executionReadings.oilTemperature}
                      onChange={(e) => setExecutionReadings({ ...executionReadings, oilTemperature: e.target.value })}
                    />
                    <span className="unit-input-addon">°C</span>
                  </div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '0.2rem', display: 'block' }}>
                    Nominal: 45°C - 65°C
                  </span>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={executionReadings.oilSampleTaken}
                  onChange={(e) => setExecutionReadings({ ...executionReadings, oilSampleTaken: e.target.checked })}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span>Lubricant bottle sealed, barcoded, and dispatched to tribology laboratory.</span>
              </label>
            </div>

            {/* Findings & Work Performed Form */}
            <form onSubmit={handleSubmitExecutionReport}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Physical Inspection Findings</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Normal tooth flank contact. Sump oil level nominal. Slight discoloration on intermediate shaft bearing."
                  value={executionFindings}
                  onChange={(e) => setExecutionFindings(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Corrective Actions Performed</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Retorqued casing fasteners to 85 Nm. Checked backlash at 0.18 mm. Replenished 250 ml ISO VG 220 oil."
                  value={executionWorkDone}
                  onChange={(e) => setExecutionWorkDone(e.target.value)}
                  required
                />
              </div>

              {/* Photo Attachment Simulation */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', padding: '0.75rem', borderRadius: '8px', border: '1px dashed var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Icon name="file" size={15} color="var(--primary)" />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {executionPhotoAttached ? 'Photo: gearbox_intermediate_pinion.jpg (1.8 MB)' : 'No photos attached yet'}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setExecutionPhotoAttached(!executionPhotoAttached)}
                >
                  {executionPhotoAttached ? 'Remove Attachment' : '+ Attach Inspection Photo'}
                </Button>
              </div>

              {/* Quick Help Request Toggle */}
              <div style={{ marginBottom: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => setExecutionShowHelpRequest(!executionShowHelpRequest)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.825rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Icon name="alert" size={13} color="var(--primary)" />
                  {executionShowHelpRequest ? 'Hide Help / Request Form' : 'Need Parts or Plant Manager Clearance to proceed?'}
                </button>

                {executionShowHelpRequest && (
                  <div style={{ marginTop: '0.75rem', padding: '0.85rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <button
                        key="req-parts"
                        type="button"
                        className={`segmented-btn ${executionHelpType === 'parts' ? 'active' : ''}`}
                        onClick={() => setExecutionHelpType('parts')}
                      >
                        Request Parts
                      </button>
                      <button
                        key="req-permission"
                        type="button"
                        className={`segmented-btn ${executionHelpType === 'permission' ? 'active' : ''}`}
                        onClick={() => setExecutionHelpType('permission')}
                      >
                        Request Permission
                      </button>
                    </div>
                    <textarea
                      className="form-input"
                      rows={2}
                      placeholder={executionHelpType === 'parts' ? 'Specify required seals, bearings, or oil quantity...' : 'Specify why shutdown or clearance is needed...'}
                      value={executionHelpReason}
                      onChange={(e) => setExecutionHelpReason(e.target.value)}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleQuickHelpSubmit}
                      >
                        Dispatch Request to Manager
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowExecutionModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" icon="file">
                  Submit for Manager Review
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANAGER DECISION (UX Pilot Page 1 & 7) */}
      {showDecisionModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">
                {decisionType === 'approved' ? 'Approve Request' : 'Reject Request'} — {selectedOrder.orderNumber}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowDecisionModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <form onSubmit={handleDecisionSubmit}>
              <div style={{ background: 'var(--bg-surface-subtle)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <strong>Technician Request:</strong>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>
                  {selectedOrder.approvalRequest?.reason}
                </p>
              </div>

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Manager Decision Note</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder={
                    decisionType === 'approved'
                      ? 'e.g. Approved. Expedited parts release issued from central store.'
                      : 'e.g. Rejected. Alternative seals available in Bay B storage cabinet.'
                  }
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowDecisionModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={decisionType === 'approved' ? 'primary' : 'outline'}
                  icon={decisionType === 'approved' ? 'check' : 'close'}
                >
                  Confirm {decisionType === 'approved' ? 'Approval' : 'Rejection'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CLARIFICATION NOTE (Manager Return) */}
      {showClarificationModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Request Clarification — {selectedOrder.orderNumber}</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowClarificationModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <form onSubmit={handleClarificationSubmit}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Return this work order to the technician with specific notes on what needs further inspection or documentation.
              </p>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Clarification Notes for Technician</label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder="e.g. Please document the oil batch lot number and verify seal lip seating depth before closing."
                  value={clarificationNote}
                  onChange={(e) => setClarificationNote(e.target.value)}
                  required
                />
              </div>
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowClarificationModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" icon="refresh">
                  Return for Clarification
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REASSIGN TECHNICIAN (Manager) */}
      {showAssignModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Reassign Technician — {selectedOrder.orderNumber}</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowAssignModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>
                Select an eligible technician. Workload counts are queried live from MongoDB factory records.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {eligibleTechs.map((tech) => {
                  const isSelected = reassignTechId === tech._id;
                  return (
                    <div
                      key={tech._id}
                      onClick={() => setReassignTechId(tech._id)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem 1rem',
                        borderRadius: '8px',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: isSelected ? 'var(--primary-glow)' : 'var(--bg-surface-subtle)',
                        cursor: 'pointer'
                      }}
                    >
                      <div>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {tech.fullName}
                        </strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {(tech.isDemoAccount || tech.email?.includes('.factory')) ? 'Demo • ' : ''}{tech.email}
                        </div>
                      </div>
                      <span className="badge badge-operational" style={{ fontSize: '0.7rem' }}>
                        {tech.activeWorkload ?? 0} ACTIVE TASKS
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-actions">
              <Button type="button" variant="outline" onClick={() => setShowAssignModal(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                icon="check"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/machines/${selectedOrder.machineId?.code}/assign`, {
                      method: 'POST',
                      credentials: 'include',
                      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                      body: JSON.stringify({ technicianId: reassignTechId })
                    });
                    if (!res.ok) throw new Error('Failed to reassign technician.');
                    setShowAssignModal(false);
                    setActionSuccess('Technician assignment updated.');
                    setTimeout(() => setActionSuccess(null), 4000);
                    fetchData();
                  } catch (err) {
                    alert(err.message);
                  }
                }}
              >
                Confirm Reassignment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
