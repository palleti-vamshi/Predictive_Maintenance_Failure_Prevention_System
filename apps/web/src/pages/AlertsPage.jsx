import React, { useState } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import { DEMO_ALERTS, DEMO_MAINTENANCE_NOTES, ALERT_SEVERITIES } from '@predictive-maintenance/shared';

/**
 * AlertsPage: Explainable condition warnings, acknowledgement workflow, and technician maintenance notes.
 */
export default function AlertsPage() {
  const [alerts, setAlerts] = useState(DEMO_ALERTS);
  const [maintenanceNotes, setMaintenanceNotes] = useState(DEMO_MAINTENANCE_NOTES);
  const [noteInput, setNoteInput] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [actionNotice, setActionNotice] = useState(null);

  const handleAcknowledge = (alertId) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, status: 'acknowledged' } : a))
    );
    setActionNotice(`Alert ${alertId} acknowledged in demo session.`);
    setTimeout(() => setActionNotice(null), 4000);
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    if (!noteInput.trim()) return;

    const newNote = {
      id: `mnt-${Date.now()}`,
      machineId: 'GB-104',
      author: 'Alex Mercer (Lead Technician) [DEMO]',
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      category: 'Field Inspection',
      content: noteInput.trim(),
      status: 'Recorded',
      isDemo: true
    };

    setMaintenanceNotes([newNote, ...maintenanceNotes]);
    setNoteInput('');
    setActionNotice('Maintenance note logged successfully in demo session.');
    setTimeout(() => setActionNotice(null), 4000);
  };

  const filteredAlerts = alerts.filter((a) => {
    if (severityFilter === 'warning') return a.severity === ALERT_SEVERITIES.WARNING;
    if (severityFilter === 'critical') return a.severity === ALERT_SEVERITIES.CRITICAL;
    return true;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts & Maintenance Notes</h1>
          <p className="page-subtitle">
            Review explainable condition warnings, inspect supporting sensor channels, and log field technician actions.
          </p>
        </div>
      </div>

      {actionNotice && (
        <div className="action-toast" role="status">
          ✓ {actionNotice}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="filter-bar">
        <button
          className={`filter-chip ${severityFilter === 'all' ? 'filter-chip-active' : ''}`}
          onClick={() => setSeverityFilter('all')}
        >
          All Warnings ({alerts.length})
        </button>
        <button
          className={`filter-chip ${severityFilter === 'warning' ? 'filter-chip-active' : ''}`}
          onClick={() => setSeverityFilter('warning')}
        >
          Warning ({alerts.filter((a) => a.severity === 'warning').length})
        </button>
        <button
          className={`filter-chip ${severityFilter === 'critical' ? 'filter-chip-active' : ''}`}
          onClick={() => setSeverityFilter('critical')}
        >
          Critical (0)
        </button>
      </div>

      {/* Alerts Feed */}
      <div className="alerts-stack">
        {filteredAlerts.map((alert) => (
          <Card
            key={alert.id}
            title={`${alert.id}: ${alert.title}`}
            subtitle={`Machine: ${alert.machineId} (${alert.machineName}) • Method: ${alert.methodLabel}`}
            badge={
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <StatusBadge
                  status={alert.severity}
                  label={alert.severity.toUpperCase()}
                  isSimulated={true}
                />
                <span className="badge badge-demo">
                  {alert.status === 'open' ? 'OPEN [DEMO]' : 'ACKNOWLEDGED [DEMO]'}
                </span>
              </div>
            }
          >
            <p className="alert-explanation-text">{alert.description}</p>

            {/* Contributing Signals Detail */}
            <div className="explainability-box">
              <span className="explainability-heading">Contributing Sensor Signals (Explainability):</span>
              <div className="signals-breakdown-grid">
                {alert.contributingSignals.map((item, idx) => (
                  <div key={idx} className="signal-explain-card warning-accent">
                    <div className="signal-card-title">{item.signal}</div>
                    <div className="signal-card-val">{item.value}</div>
                    <div className="signal-card-meta">
                      Baseline: {item.baseline} • <strong>{item.delta} deviation</strong>
                    </div>
                  </div>
                ))}
                {alert.unaffectedSignals.map((item, idx) => (
                  <div key={idx} className="signal-explain-card healthy-accent">
                    <div className="signal-card-title">{item.signal}</div>
                    <div className="signal-card-val">{item.value}</div>
                    <div className="signal-card-meta">{item.note}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="alert-footer-row">
              <div className="alert-sufficiency-text">
                <strong>Data Sufficiency:</strong> {alert.dataSufficiency}
              </div>
              <div>
                {alert.status === 'open' ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleAcknowledge(alert.id)}
                  >
                    Acknowledge Alert (Demo Action)
                  </Button>
                ) : (
                  <span className="text-secondary text-sm">✓ Acknowledged by Alex Mercer [DEMO]</span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Technician Maintenance Note Form & History */}
      <div className="grid-two-col">
        {/* Form */}
        <Card
          title="Log Field Maintenance Note"
          subtitle="Record mechanical inspection findings, lubrication actions, or sensor replacements"
        >
          <form onSubmit={handleAddNote}>
            <div className="form-group">
              <label className="form-label" htmlFor="note-content">
                Maintenance Observation / Field Action:
              </label>
              <textarea
                id="note-content"
                className="form-textarea"
                rows={4}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="e.g. Inspected high-speed pinion bearing, measured axial play, refilled 200ml ISO VG 220 gear oil..."
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={!noteInput.trim()}
            >
              Record Maintenance Note (Demo Session)
            </Button>
          </form>
        </Card>

        {/* History */}
        <Card
          title="Maintenance Action History"
          subtitle="Immutable log of technician actions for monitored machines"
          badge={<StatusBadge status="info" label={`${maintenanceNotes.length} Entries`} isSimulated={true} />}
        >
          <div className="notes-feed">
            {maintenanceNotes.map((note) => (
              <div key={note.id} className="note-item">
                <div className="note-header">
                  <span className="note-author">{note.author}</span>
                  <span className="note-time">{note.timestamp}</span>
                </div>
                <div className="note-category-pill">{note.category}</div>
                <p className="note-content">{note.content}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

