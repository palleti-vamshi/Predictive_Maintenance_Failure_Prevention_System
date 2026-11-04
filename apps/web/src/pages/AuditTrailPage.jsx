import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import LoadingSkeleton from '../components/common/LoadingSkeleton.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter, ROUTES } from '../router/Router.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * AuditTrailPage: Chronological, immutable governance stream of all factory operational actions.
 * Tracks dataset uploads, analysis executions, alert acknowledgements,
 * work order creations, status transitions, and parts/permission approval decisions.
 */
export default function AuditTrailPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;

  const [auditEvents, setAuditEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actorFilter, setActorFilter] = useState('all');

  const fetchAuditTrail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/audit-trail`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Access restricted: Audit trail is available to Factory Managers only.');
        }
        throw new Error('Failed to retrieve factory audit trail records.');
      }

      const data = await res.json();
      setAuditEvents(data.auditEvents || []);
    } catch (err) {
      console.error('[AuditTrailPage] Error:', err);
      setError(err.message || 'Error loading audit logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuditTrail();
  }, [fetchAuditTrail]);

  // Unique Actors list for filtering
  const uniqueActors = useMemo(() => {
    const set = new Set();
    auditEvents.forEach((e) => {
      if (e.actor) set.add(e.actor);
    });
    return Array.from(set).sort();
  }, [auditEvents]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return auditEvents.filter((event) => {
      if (categoryFilter !== 'all' && event.category?.toLowerCase() !== categoryFilter.toLowerCase()) {
        return false;
      }
      if (actorFilter !== 'all' && event.actor !== actorFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = event.title?.toLowerCase().includes(q);
        const matchDesc = event.description?.toLowerCase().includes(q);
        const matchActor = event.actor?.toLowerCase().includes(q);
        const matchTarget = event.target?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchActor && !matchTarget) {
          return false;
        }
      }
      return true;
    });
  }, [auditEvents, categoryFilter, actorFilter, searchQuery]);

  // Metrics Summary
  const metrics = useMemo(() => {
    const total = auditEvents.length;
    const maintenance = auditEvents.filter((e) => e.category === 'Maintenance').length;
    const approvals = auditEvents.filter((e) => e.category === 'Approvals').length;
    const alerts = auditEvents.filter((e) => e.category === 'Alerts').length;
    const analytics = auditEvents.filter((e) => e.category === 'Analytics').length;
    const ingestion = auditEvents.filter((e) => e.category === 'Ingestion').length;
    return { total, maintenance, approvals, alerts, analytics, ingestion };
  }, [auditEvents]);

  // Export CSV Handler
  const handleExportCsv = () => {
    if (filteredEvents.length === 0) return;
    const headers = ['Timestamp', 'Category', 'Action Title', 'Actor', 'Role', 'Target Machine', 'Description'];
    const rows = filteredEvents.map((e) => [
      new Date(e.timestamp).toISOString(),
      `"${e.category || ''}"`,
      `"${(e.title || '').replace(/"/g, '""')}"`,
      `"${(e.actor || '').replace(/"/g, '""')}"`,
      `"${e.role || ''}"`,
      `"${e.target || ''}"`,
      `"${(e.description || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `factory_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatTimestamp = (ts) => {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  };

  const getCategoryBadge = (category) => {
    switch (category) {
      case 'Maintenance':
        return <StatusBadge status="info" label="MAINTENANCE" />;
      case 'Approvals':
        return <StatusBadge status="warning" label="APPROVALS" />;
      case 'Alerts':
        return <StatusBadge status="critical" label="ALERTS" />;
      case 'Analytics':
        return <StatusBadge status="healthy" label="ANALYTICS" />;
      case 'Ingestion':
        return <StatusBadge status="default" label="INGESTION" />;
      default:
        return <StatusBadge status="default" label={category?.toUpperCase() || 'LOG'} />;
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'Maintenance':
        return 'wrench';
      case 'Approvals':
        return 'shield';
      case 'Alerts':
        return 'alert';
      case 'Analytics':
        return 'analysis';
      case 'Ingestion':
        return 'upload';
      default:
        return 'book';
    }
  };

  if (!isManager) {
    return (
      <div className="page-container">
        <EmptyState
          icon="shield"
          title="Manager Permissions Required"
          description="The factory audit trail and governance log is restricted to authorized Factory Managers. Please switch to an authorized manager account."
          actionText="Go to My Work Orders"
          onAction={() => navigate(ROUTES.MAINTENANCE)}
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span className="badge badge-demo">AUDIT & GOVERNANCE</span>
            <span className="badge badge-info">MONGODB PERSISTED</span>
          </div>
          <h1 className="page-title" style={{ fontSize: '1.65rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Operational Audit Trail
          </h1>
          <p className="page-subtitle" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>
            Immutable chronological record of dataset uploads, model runs, alert actions, maintenance tasks, and approvals.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Button
            variant="secondary"
            icon="download"
            onClick={handleExportCsv}
            disabled={loading || filteredEvents.length === 0}
            title="Export filtered audit logs as CSV file"
          >
            Export Audit CSV
          </Button>
          <Button
            variant="secondary"
            icon="refresh"
            onClick={fetchAuditTrail}
            disabled={loading}
            title="Refresh latest audit events from database"
          >
            Refresh Logs
          </Button>
        </div>
      </div>

      {/* KPI Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="metric-box">
          <span className="metric-box-label">TOTAL AUDIT EVENTS</span>
          <span className="metric-box-val text-accent">{metrics.total}</span>
          <span className="metric-box-sub">Persisted in MongoDB</span>
        </div>
        <div className="metric-box">
          <span className="metric-box-label">MAINTENANCE ACTIONS</span>
          <span className="metric-box-val">{metrics.maintenance}</span>
          <span className="metric-box-sub">Dispatches & status changes</span>
        </div>
        <div className="metric-box">
          <span className="metric-box-label">PARTS & APPROVALS</span>
          <span className="metric-box-val" style={{ color: 'var(--status-warning)' }}>{metrics.approvals}</span>
          <span className="metric-box-sub">Requests & manager reviews</span>
        </div>
        <div className="metric-box">
          <span className="metric-box-label">ALERTS ACKNOWLEDGED</span>
          <span className="metric-box-val" style={{ color: 'var(--status-critical)' }}>{metrics.alerts}</span>
          <span className="metric-box-sub">Obs notes & work creation</span>
        </div>
        <div className="metric-box">
          <span className="metric-box-label">ANALYSIS RUNS</span>
          <span className="metric-box-val" style={{ color: 'var(--status-healthy)' }}>{metrics.analytics}</span>
          <span className="metric-box-sub">ML anomaly executions</span>
        </div>
        <div className="metric-box">
          <span className="metric-box-label">DATASET INGESTIONS</span>
          <span className="metric-box-val">{metrics.ingestion}</span>
          <span className="metric-box-sub">CSV signal profiles</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Category Tabs */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All Events (${metrics.total})` },
              { id: 'maintenance', label: `Maintenance (${metrics.maintenance})` },
              { id: 'approvals', label: `Approvals (${metrics.approvals})` },
              { id: 'alerts', label: `Alerts (${metrics.alerts})` },
              { id: 'analytics', label: `Analytics (${metrics.analytics})` },
              { id: 'ingestion', label: `Ingestion (${metrics.ingestion})` }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`filter-chip ${categoryFilter === tab.id ? 'filter-chip-active' : ''}`}
                style={{
                  padding: '0.4rem 0.85rem',
                  borderRadius: '20px',
                  border: '1px solid',
                  borderColor: categoryFilter === tab.id ? 'var(--primary)' : 'var(--border-subtle)',
                  background: categoryFilter === tab.id ? 'var(--primary-subtle)' : '#ffffff',
                  color: categoryFilter === tab.id ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: categoryFilter === tab.id ? 600 : 400,
                  fontSize: '0.825rem',
                  cursor: 'pointer'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search & Actor Filter */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search by action, machine, or actor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '260px', padding: '0.45rem 0.75rem', fontSize: '0.825rem' }}
            />

            <select
              className="form-input"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              style={{ width: '180px', padding: '0.45rem 0.75rem', fontSize: '0.825rem' }}
              aria-label="Filter by Actor"
            >
              <option value="all">All Actors ({uniqueActors.length})</option>
              {uniqueActors.map((actor) => (
                <option key={actor} value={actor}>{actor}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Main Audit List */}
      {loading ? (
        <LoadingSkeleton count={6} height="70px" />
      ) : error ? (
        <div className="login-error-alert" role="alert" style={{ marginBottom: '1.5rem' }}>
          <Icon name="alert" size={18} color="var(--status-critical)" />
          <span>{error}</span>
        </div>
      ) : filteredEvents.length === 0 ? (
        <EmptyState
          icon="book"
          title="No Audit Records Found"
          description={
            searchQuery || categoryFilter !== 'all' || actorFilter !== 'all'
              ? 'No audit events match your current filter criteria. Try resetting filters.'
              : 'No operational audit events recorded yet for this factory facility.'
          }
          actionText={searchQuery || categoryFilter !== 'all' || actorFilter !== 'all' ? 'Reset Filters' : undefined}
          onAction={() => {
            setCategoryFilter('all');
            setActorFilter('all');
            setSearchQuery('');
          }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredEvents.map((event) => (
            <div
              key={event.id}
              className="audit-event-card"
              style={{
                background: '#ffffff',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1rem',
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', flex: 1 }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px'
                  }}
                >
                  <Icon name={getCategoryIcon(event.category)} size={18} color="var(--primary)" />
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                    {getCategoryBadge(event.category)}
                    {event.target && (
                      <span className="mono-code" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)' }}>
                        {event.target}
                      </span>
                    )}
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {event.title}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem 0', lineHeight: 1.45 }}>
                    {event.description}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>
                      Actor: <strong style={{ color: 'var(--text-primary)' }}>{event.actor}</strong> ({event.role})
                    </span>
                    <span>•</span>
                    <span>{formatTimestamp(event.timestamp)}</span>
                  </div>
                </div>
              </div>

              {/* Action Quick Jump */}
              <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {event.category === 'Maintenance' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(ROUTES.MAINTENANCE)}
                    title="View Work Order in Maintenance Desk"
                  >
                    View Task
                  </Button>
                )}
                {event.category === 'Alerts' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(ROUTES.ALERTS)}
                    title="View Condition Alert"
                  >
                    View Alert
                  </Button>
                )}
                {event.category === 'Analytics' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(ROUTES.ANALYSIS)}
                    title="Inspect ML Analysis"
                  >
                    Inspect Run
                  </Button>
                )}
                {event.category === 'Ingestion' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(ROUTES.DATASETS_UPLOAD)}
                    title="View Ingestion Ledger"
                  >
                    View Dataset
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
