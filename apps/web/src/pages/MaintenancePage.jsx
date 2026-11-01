import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';
import Button from '../components/common/Button.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  WORK_ORDER_STATUS,
  WORK_ORDER_PRIORITY,
  USER_ROLES
} from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function MaintenancePage() {
  const { user } = useAuth();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;
  const isTech = user?.role === USER_ROLES.TECHNICIAN;

  const [workOrders, setWorkOrders] = useState([]);
  const [eligibleTechs, setEligibleTechs] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Filters
  const [activeTab, setActiveTab] = useState(isTech ? 'my_work' : 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // Modals state
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [showSubmitWorkModal, setShowSubmitWorkModal] = useState(false);
  const [showClarificationModal, setShowClarificationModal] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState({});

  // Form states
  const [partsReason, setPartsReason] = useState('');
  const [permissionReason, setPermissionReason] = useState('');
  const [decisionType, setDecisionType] = useState('approved');
  const [decisionNote, setDecisionNote] = useState('');
  const [clarificationNote, setClarificationNote] = useState('');
  const [workReport, setWorkReport] = useState({
    findings: '',
    workPerformed: '',
    followUpNeeded: ''
  });
  const [reassignTechId, setReassignTechId] = useState('');

  // Create Work Order Form State
  const [newOrder, setNewOrder] = useState({
    machineCode: '',
    title: '',
    description: '',
    priority: WORK_ORDER_PRIORITY.MEDIUM,
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    assignedTechnicianId: ''
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
        setEligibleTechs(techsData.technicians || []);
        if (techsData.technicians?.length > 0 && !newOrder.assignedTechnicianId) {
          setNewOrder((prev) => ({ ...prev, assignedTechnicianId: techsData.technicians[0]._id }));
        }
      }

      if (machinesRes && machinesRes.ok) {
        const machinesData = await machinesRes.json();
        setMachines(machinesData.machines || []);
        if (machinesData.machines?.length > 0 && !newOrder.machineCode) {
          setNewOrder((prev) => ({ ...prev, machineCode: machinesData.machines[0].code }));
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

  // Tab Filtering & Counts
  const filteredOrders = useMemo(() => {
    return workOrders.filter((order) => {
      // Tab filter
      if (activeTab === 'my_work') {
        const techId = order.assignedTechnicianId?._id || order.assignedTechnicianId;
        if (techId?.toString() !== user?._id?.toString()) return false;
      } else if (activeTab === 'in_progress') {
        if (order.status !== WORK_ORDER_STATUS.IN_PROGRESS && order.status !== WORK_ORDER_STATUS.ASSIGNED && order.status !== WORK_ORDER_STATUS.ACCEPTED) return false;
      } else if (activeTab === 'action_needed') {
        if (order.status !== WORK_ORDER_STATUS.WAITING_FOR_PARTS && order.status !== WORK_ORDER_STATUS.WAITING_FOR_APPROVAL) return false;
      } else if (activeTab === 'review_pending') {
        if (order.status !== WORK_ORDER_STATUS.WORK_SUBMITTED && order.status !== WORK_ORDER_STATUS.MANAGER_REVIEW) return false;
      } else if (activeTab === 'completed') {
        if (order.status !== WORK_ORDER_STATUS.COMPLETED && order.status !== WORK_ORDER_STATUS.REVIEWED) return false;
      }

      // Priority filter
      if (priorityFilter !== 'all' && order.priority !== priorityFilter) return false;

      // Search query
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
  }, [workOrders, activeTab, priorityFilter, searchQuery, user?._id]);

  // KPI Calculations
  const metrics = useMemo(() => {
    const total = workOrders.length;
    const inProgress = workOrders.filter((o) => [WORK_ORDER_STATUS.IN_PROGRESS, WORK_ORDER_STATUS.ASSIGNED, WORK_ORDER_STATUS.ACCEPTED].includes(o.status)).length;
    const actionNeeded = workOrders.filter((o) => [WORK_ORDER_STATUS.WAITING_FOR_PARTS, WORK_ORDER_STATUS.WAITING_FOR_APPROVAL].includes(o.status)).length;
    const reviewPending = workOrders.filter((o) => [WORK_ORDER_STATUS.WORK_SUBMITTED, WORK_ORDER_STATUS.MANAGER_REVIEW].includes(o.status)).length;
    const completed = workOrders.filter((o) => [WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(o.status)).length;
    return { total, inProgress, actionNeeded, reviewPending, completed };
  }, [workOrders]);

  // Action Handlers
  const handleAcceptTask = async (orderId) => {
    try {
      const res = await fetch(`${API_BASE}/work-orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          status: WORK_ORDER_STATUS.IN_PROGRESS,
          note: 'Technician acknowledged and commenced maintenance task.'
        })
      });
      if (!res.ok) throw new Error('Failed to accept task.');
      setActionSuccess('Work order marked In Progress.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRequestPartsSubmit = async (e) => {
    e.preventDefault();
    if (!partsReason.trim() || !selectedOrder) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${selectedOrder._id}/request-parts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason: partsReason.trim() })
      });
      if (!res.ok) throw new Error('Failed to submit parts request.');
      setShowPartsModal(false);
      setPartsReason('');
      setSelectedOrder(null);
      setActionSuccess('Parts request submitted to manager.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRequestPermissionSubmit = async (e) => {
    e.preventDefault();
    if (!permissionReason.trim() || !selectedOrder) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${selectedOrder._id}/request-approval`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reason: permissionReason.trim() })
      });
      if (!res.ok) throw new Error('Failed to submit permission request.');
      setShowPermissionModal(false);
      setPermissionReason('');
      setSelectedOrder(null);
      setActionSuccess('Permission request submitted to manager.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

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
          decisionNote: decisionNote.trim()
        })
      });
      if (!res.ok) throw new Error('Failed to submit decision.');
      setShowDecisionModal(false);
      setDecisionNote('');
      setSelectedOrder(null);
      setActionSuccess(`Request ${decisionType.toUpperCase()} and task resumed.`);
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSubmitWorkReport = async (e) => {
    e.preventDefault();
    if (!selectedOrder) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${selectedOrder._id}/submit-work`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          findings: workReport.findings.trim(),
          workPerformed: workReport.workPerformed.trim(),
          followUpNeeded: workReport.followUpNeeded.trim()
        })
      });
      if (!res.ok) throw new Error('Failed to submit work report.');
      setShowSubmitWorkModal(false);
      setWorkReport({ findings: '', workPerformed: '', followUpNeeded: '' });
      setSelectedOrder(null);
      setActionSuccess('Work report submitted for manager review.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

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
      setActionSuccess('Returned to technician with clarification note.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleManagerComplete = async (orderId) => {
    if (!window.confirm('Approve and mark this maintenance work order as COMPLETED and REVIEWED?')) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          status: WORK_ORDER_STATUS.REVIEWED,
          note: 'Reviewed and closed by plant manager.'
        })
      });
      if (!res.ok) throw new Error('Failed to complete work order.');
      setActionSuccess('Work order approved and closed.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateOrderSubmit = async (e) => {
    e.preventDefault();
    if (!newOrder.machineCode || !newOrder.title.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/machines/${newOrder.machineCode}/work-orders`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          title: newOrder.title.trim(),
          description: newOrder.description.trim(),
          priority: newOrder.priority,
          dueDate: newOrder.dueDate,
          assignedTechnicianId: newOrder.assignedTechnicianId
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to create work order.');
      }
      setShowCreateModal(false);
      setNewOrder({
        machineCode: machines[0]?.code || '',
        title: '',
        description: '',
        priority: WORK_ORDER_PRIORITY.MEDIUM,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        assignedTechnicianId: eligibleTechs[0]?._id || ''
      });
      setActionSuccess('Work order successfully created and assigned.');
      setTimeout(() => setActionSuccess(null), 4000);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleHistory = (orderId) => {
    setExpandedHistory((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-demo">DEMO DATA</span>
            <span className="badge badge-operational">WORK ORDER LIFECYCLE</span>
          </div>
          <h1 className="page-title">Maintenance Work Orders & Operations</h1>
          <p className="page-subtitle">
            Coordinate inspections, workload-aware technician dispatch, parts requests, and completion reviews.
          </p>
        </div>

        {isManager && (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setShowCreateModal(true)}
          >
            Create Work Order
          </Button>
        )}
      </div>

      {actionSuccess && (
        <AlertCallout
          severity="low"
          title="Operation Successful"
          description={actionSuccess}
        />
      )}

      {/* KPI Metrics Summary Bar */}
      <div className="metrics-grid" style={{ marginBottom: '1.5rem' }}>
        <MetricSummary
          label="Total Work Orders"
          value={metrics.total}
          change="Factory fleet active orders"
          changeType="neutral"
          icon="wrench"
        />
        <MetricSummary
          label="In Progress / Dispatched"
          value={metrics.inProgress}
          change="Active technician execution"
          changeType="neutral"
          icon="clock"
        />
        <MetricSummary
          label="Action Needed"
          value={metrics.actionNeeded}
          change="Waiting for parts / approval"
          changeType={metrics.actionNeeded > 0 ? 'warning' : 'neutral'}
          icon="alert"
        />
        <MetricSummary
          label="In Manager Review"
          value={metrics.reviewPending}
          change="Submitted work reports"
          changeType={metrics.reviewPending > 0 ? 'warning' : 'neutral'}
          icon="activity"
        />
        <MetricSummary
          label="Completed & Closed"
          value={metrics.completed}
          change="Verified maintenance tasks"
          changeType="positive"
          icon="check"
        />
      </div>

      {/* Tabs and Filters */}
      <div className="filter-controls-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {isTech && (
            <button
              type="button"
              className={`filter-pill-btn ${activeTab === 'my_work' ? 'active' : ''}`}
              onClick={() => setActiveTab('my_work')}
            >
              My Assigned Work
            </button>
          )}
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Orders ({workOrders.length})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === 'in_progress' ? 'active' : ''}`}
            onClick={() => setActiveTab('in_progress')}
          >
            In Progress ({metrics.inProgress})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === 'action_needed' ? 'active' : ''}`}
            onClick={() => setActiveTab('action_needed')}
          >
            Parts & Approval ({metrics.actionNeeded})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === 'review_pending' ? 'active' : ''}`}
            onClick={() => setActiveTab('review_pending')}
          >
            Manager Review ({metrics.reviewPending})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${activeTab === 'completed' ? 'active' : ''}`}
            onClick={() => setActiveTab('completed')}
          >
            Completed ({metrics.completed})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div className="search-input-wrapper" style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search by order, machine, title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '2rem', width: '240px' }}
            />
            <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}>
              <Icon name="filter" size={14} color="var(--text-tertiary)" />
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
      </div>

      {/* Main Content Area */}
      {loading ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            <p>Loading maintenance work orders from MongoDB API...</p>
          </div>
        </Card>
      ) : error ? (
        <AlertCallout
          severity="high"
          title="Error Loading Work Orders"
          description={error}
        />
      ) : filteredOrders.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            <Icon name="wrench" size={40} color="var(--primary-light)" />
            <h3 style={{ marginTop: '1rem', color: 'var(--text-primary)' }}>No Work Orders Found</h3>
            <p style={{ maxWidth: '420px', margin: '0.5rem auto 1.5rem auto' }}>
              {searchQuery || priorityFilter !== 'all' || activeTab !== 'all'
                ? 'No maintenance records match your active search or status filters.'
                : 'There are currently no maintenance work orders recorded in this factory scope.'}
            </p>
            {isManager && (
              <Button variant="primary" icon="plus" onClick={() => setShowCreateModal(true)}>
                Create Work Order
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredOrders.map((order) => {
            const isAssignedToUser = (order.assignedTechnicianId?._id || order.assignedTechnicianId)?.toString() === user?._id?.toString();
            const isHistoryOpen = !!expandedHistory[order._id];
            const hasPendingApproval = order.approvalRequest && order.approvalRequest.status === 'pending';
            const isWorkSubmitted = order.status === WORK_ORDER_STATUS.WORK_SUBMITTED || order.status === WORK_ORDER_STATUS.MANAGER_REVIEW;

            return (
              <Card key={order._id} className="work-order-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--primary)' }}>
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <StatusBadge
                      status={
                        [WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(order.status)
                          ? 'healthy'
                          : [WORK_ORDER_STATUS.WAITING_FOR_PARTS, WORK_ORDER_STATUS.WAITING_FOR_APPROVAL, WORK_ORDER_STATUS.WORK_SUBMITTED].includes(order.status)
                          ? 'warning'
                          : 'operational'
                      }
                      label={order.status?.replace(/_/g, ' ')?.toUpperCase()}
                    />
                  </div>
                </div>

                <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>
                  {order.title}
                </h3>
                <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5 }}>
                  {order.description}
                </p>

                {/* Assigned Technician & Due Date Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-surface-subtle)', borderRadius: '8px', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary-glow)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem' }}>
                      {order.assignedTechnicianId?.fullName?.substring(0, 2)?.toUpperCase() || 'TC'}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {order.assignedTechnicianId?.fullName || 'Assigned Technician'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {order.assignedTechnicianId?.email}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <div>
                      <span style={{ color: 'var(--text-tertiary)' }}>Due: </span>
                      <strong style={{ color: new Date(order.dueDate) < new Date() && order.status !== WORK_ORDER_STATUS.REVIEWED ? '#dc2626' : 'var(--text-primary)' }}>
                        {new Date(order.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-tertiary)' }}>Created by: </span>
                      <strong>{order.createdById?.fullName || 'Plant Manager'}</strong>
                    </div>
                  </div>
                </div>

                {/* Conditional Callout: Pending Parts / Permission Request */}
                {hasPendingApproval && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <strong style={{ color: '#b45309', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Icon name="clock" size={14} color="#b45309" />
                        {order.approvalRequest.requestType === 'parts' ? 'Parts Procurement Requested' : 'Manager Permission Requested'}
                      </strong>
                      <span style={{ fontSize: '0.75rem', color: '#92400e' }}>
                        Requested {new Date(order.approvalRequest.requestedAt).toLocaleTimeString()}
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
                    {isTech && (
                      <span style={{ fontSize: '0.75rem', color: '#b45309', fontStyle: 'italic' }}>
                        Awaiting manager review and approval note to proceed.
                      </span>
                    )}
                  </div>
                )}

                {/* Conditional Callout: Submitted Work Report (Pending Manager Review) */}
                {isWorkSubmitted && order.technicianFeedback && (
                  <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--primary-light)', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong style={{ color: 'var(--primary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Icon name="file" size={14} color="var(--primary)" />
                        Technician Inspection & Work Report Submitted
                      </strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {order.technicianFeedback.submittedAt ? new Date(order.technicianFeedback.submittedAt).toLocaleString() : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', display: 'grid', gap: '0.35rem', marginBottom: '0.75rem' }}>
                      <div><strong>Findings:</strong> {order.technicianFeedback.findings || 'No physical defects noted.'}</div>
                      <div><strong>Work Performed:</strong> {order.technicianFeedback.workPerformed || 'Inspection completed.'}</div>
                      {order.technicianFeedback.followUpNeeded && (
                        <div><strong>Follow-up Needed:</strong> {order.technicianFeedback.followUpNeeded}</div>
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

                {/* Conditional Callout: Completed / Reviewed Work Order */}
                {[WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED].includes(order.status) && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' }}>
                      <Icon name="check" size={14} color="#16a34a" />
                      Work Order Reviewed & Closed by {order.reviewedById?.fullName || 'Plant Manager'}
                    </div>
                    {order.reviewNotes && (
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#15803d' }}>
                        <strong>Review Note:</strong> {order.reviewNotes}
                      </p>
                    )}
                  </div>
                )}

                {/* Actions Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {/* Technician Actions */}
                    {isTech && isAssignedToUser && (
                      <>
                        {[WORK_ORDER_STATUS.OPEN, WORK_ORDER_STATUS.ASSIGNED].includes(order.status) && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon="play"
                            onClick={() => handleAcceptTask(order._id)}
                          >
                            Accept & Start Work
                          </Button>
                        )}
                        {order.status === WORK_ORDER_STATUS.IN_PROGRESS && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              icon="wrench"
                              onClick={() => {
                                setSelectedOrder(order);
                                setShowPartsModal(true);
                              }}
                            >
                              Request Parts
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              icon="shield"
                              onClick={() => {
                                setSelectedOrder(order);
                                setShowPermissionModal(true);
                              }}
                            >
                              Request Permission
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              icon="file"
                              onClick={() => {
                                setSelectedOrder(order);
                                setShowSubmitWorkModal(true);
                              }}
                            >
                              Submit Work Report
                            </Button>
                          </>
                        )}
                      </>
                    )}

                    {/* Manager Actions */}
                    {isManager && (
                      <Button
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
                    <div className="audit-timeline" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {order.statusHistory?.map((step, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.8rem', position: 'relative' }}>
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

      {/* Modal: Create Work Order (Manager Only) */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '580px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Create Maintenance Work Order</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateOrderSubmit}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Target Gearbox Machine</label>
                <select
                  className="form-select"
                  value={newOrder.machineCode}
                  onChange={(e) => setNewOrder({ ...newOrder, machineCode: e.target.value })}
                  required
                >
                  {machines.map((m) => (
                    <option key={m._id} value={m.code}>
                      {m.code} — {m.name} ({m.arrangement || 'Gearbox'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Work Order Title</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Inspect High-Speed Shaft Seal & Sump Oil Sample"
                  value={newOrder.title}
                  onChange={(e) => setNewOrder({ ...newOrder, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Detailed Description & Scope</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Specific inspection instructions, torque requirements, lubricant grades, or anomaly investigations."
                  value={newOrder.description}
                  onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    className="form-select"
                    value={newOrder.priority}
                    onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value })}
                  >
                    <option value={WORK_ORDER_PRIORITY.LOW}>Low</option>
                    <option value={WORK_ORDER_PRIORITY.MEDIUM}>Medium</option>
                    <option value={WORK_ORDER_PRIORITY.HIGH}>High</option>
                    <option value={WORK_ORDER_PRIORITY.CRITICAL}>Critical</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Target Due Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={newOrder.dueDate}
                    onChange={(e) => setNewOrder({ ...newOrder, dueDate: e.target.value })}
                    required
                  />
                </div>
              </div>

              {/* Workload-Aware Technician Assignment Selector */}
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Assign Technician (Workload-Aware)</label>
                <select
                  className="form-select"
                  value={newOrder.assignedTechnicianId}
                  onChange={(e) => setNewOrder({ ...newOrder, assignedTechnicianId: e.target.value })}
                  required
                >
                  {eligibleTechs.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.fullName} {(t.isDemoAccount || t.email?.includes('.factory')) ? '[Demo] ' : ''}— {t.activeWorkload ?? 0} active tasks ({t.availabilityStatus || 'available'})
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  Workload is calculated in real time from open factory work orders in MongoDB.
                </div>
              </div>

              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" icon="check">
                  Dispatch Work Order
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Request Parts (Technician) */}
      {showPartsModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Request Parts for {selectedOrder.orderNumber}</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowPartsModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <form onSubmit={handleRequestPartsSubmit}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Specify the required replacement parts, quantities, part numbers, and reason for replenishment.
              </p>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Parts Description & Reason</label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder="e.g. Need 2x SKF 110x140x12 Viton lip seals. Current inventory depleted, weeping detected."
                  value={partsReason}
                  onChange={(e) => setPartsReason(e.target.value)}
                  required
                />
              </div>
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowPartsModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" icon="wrench">
                  Submit Parts Request
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Request Permission to Proceed (Technician) */}
      {showPermissionModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Request Permission for {selectedOrder.orderNumber}</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowPermissionModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <form onSubmit={handleRequestPermissionSubmit}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Submit a safety or shutdown authorization request before proceeding with high-risk gearbox operations.
              </p>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Permission Justification & Details</label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder="e.g. Requesting 30-minute line stoppage to decouple motor and measure input pinion backlash."
                  value={permissionReason}
                  onChange={(e) => setPermissionReason(e.target.value)}
                  required
                />
              </div>
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowPermissionModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" icon="shield">
                  Submit Permission Request
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Manager Decision on Parts / Permission */}
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
                      ? 'e.g. Approved. Purchase order #PO-8821 placed with expedited delivery.'
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

      {/* Modal: Submit Work Report (Technician) */}
      {showSubmitWorkModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Submit Maintenance Report — {selectedOrder.orderNumber}</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowSubmitWorkModal(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <form onSubmit={handleSubmitWorkReport}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Inspection Findings</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Seal lips intact, slight surface discoloration on input shaft. Oil level was 150ml low."
                  value={workReport.findings}
                  onChange={(e) => setWorkReport({ ...workReport, findings: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Work Performed & Corrective Actions</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="e.g. Cleaned housing labyrinth grooves. Replaced oil seal with Viton RG. Replenished 300ml ISO VG 220 oil."
                  value={workReport.workPerformed}
                  onChange={(e) => setWorkReport({ ...workReport, workPerformed: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Follow-up Recommendations (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Recheck oil level at 250 operational hours."
                  value={workReport.followUpNeeded}
                  onChange={(e) => setWorkReport({ ...workReport, followUpNeeded: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowSubmitWorkModal(false)}>
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

      {/* Modal: Request Clarification (Manager) */}
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

      {/* Modal: Workload-Aware Technician Reassignment (Manager) */}
      {showAssignModal && selectedOrder && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '580px' }}>
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
                Select an eligible technician. Active workloads and specialized competencies are loaded directly from factory records.
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            {tech.fullName}
                          </strong>
                          {(tech.isDemoAccount || tech.email?.includes('.factory')) && (
                            <span className="badge badge-demo" style={{ fontSize: '0.7rem', padding: '1px 5px' }}>
                              Demo account
                            </span>
                          )}
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                            ({tech.email})
                          </span>
                        </div>
                        {tech.skills?.length > 0 && (
                          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                            {tech.skills.map((skill, sIdx) => (
                              <span
                                key={sIdx}
                                style={{
                                  fontSize: '0.7rem',
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '4px',
                                  background: '#ffffff',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-secondary)'
                                }}
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span
                          className={`badge ${
                            tech.availabilityStatus === 'available'
                              ? 'badge-healthy'
                              : tech.availabilityStatus === 'assigned'
                              ? 'badge-operational'
                              : 'badge-warning'
                          }`}
                          style={{ fontSize: '0.7rem' }}
                        >
                          {tech.activeWorkload ?? 0} ACTIVE TASKS
                        </span>
                      </div>
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
                    // Update technician assignment on machine or status
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
                Confirm Assignment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

