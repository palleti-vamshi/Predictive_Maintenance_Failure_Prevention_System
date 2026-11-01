import React from 'react';
import Card from '../components/common/Card.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import { DEMO_FACTORY, DEMO_MACHINES, DEMO_ALERTS, DEMO_DATASETS } from '@predictive-maintenance/shared';
import { useRouter, ROUTES } from '../router/Router.jsx';

/**
 * FactoryOverviewPage: High-level plant health, machine fleet status, and active alerts.
 */
export default function FactoryOverviewPage() {
  const { navigate } = useRouter();
  const alert = DEMO_ALERTS[0];

  return (
    <div className="page-container">
      {/* Page Title & Scope Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Factory Condition Overview</h1>
          <p className="page-subtitle">
            Plant-level condition monitoring and active alert summary for <strong>{DEMO_FACTORY.name}</strong>.
          </p>
        </div>
        <div className="page-header-actions">
          <Button
            variant="primary"
            onClick={() => navigate(ROUTES.DATASETS_UPLOAD)}
            icon="⬆️"
          >
            Upload Machine Dataset
          </Button>
        </div>
      </div>

      {/* Engineering Metric Summaries */}
      <div className="metrics-grid">
        <MetricSummary
          label="Registered Gearboxes"
          value={DEMO_MACHINES.length}
          unit="Units"
          status="info"
          sublabel="Multi-stage industrial profiles"
          isSimulated={true}
        />
        <MetricSummary
          label="Active Machine Alerts"
          value={DEMO_ALERTS.length}
          unit="Warning"
          status="warning"
          sublabel="1 specimen requires inspection"
          isSimulated={true}
        />
        <MetricSummary
          label="Operational Datasets"
          value={DEMO_DATASETS.length}
          unit="Records"
          status="healthy"
          sublabel="Avg. 99.8% data coverage"
          isSimulated={true}
        />
        <MetricSummary
          label="Analysis Engine Status"
          value="Ready"
          unit="Idle"
          status="healthy"
          sublabel="Baseline & Isolation Forest"
          isSimulated={true}
        />
      </div>

      {/* Active Alert Highlight */}
      <Card
        title="Active Condition Warning"
        subtitle="Current machine alert requiring technician review and acknowledgement"
        badge={<StatusBadge status="warning" label="1 Warning" isSimulated={true} />}
      >
        <AlertCallout
          severity={alert.severity}
          title={`${alert.machineId}: ${alert.title}`}
          description={alert.description}
          timestamp={new Date(alert.timestamp).toLocaleString()}
          contributingSignals={alert.contributingSignals}
          isSimulated={true}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(ROUTES.ALERTS)}
            >
              Review Explainable Alert & Add Notes →
            </Button>
          }
        />
      </Card>

      {/* Registered Gearbox Fleet */}
      <Card
        title="Gearbox Specimen Fleet"
        subtitle="Monitored mechanical drive units in current factory scope"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(ROUTES.MACHINES)}
          >
            View All Machines →
          </Button>
        }
      >
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Machine ID</th>
                <th scope="col">Equipment Name</th>
                <th scope="col">Site Location</th>
                <th scope="col">Stages & Ratio</th>
                <th scope="col">Condition State</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_MACHINES.map((machine) => (
                <tr key={machine.id}>
                  <td>
                    <span className="mono-code">{machine.id}</span>
                  </td>
                  <td>
                    <div className="table-primary-text">{machine.name}</div>
                    <div className="table-subtext">{machine.manufacturer} • {machine.model}</div>
                  </td>
                  <td>{machine.site}</td>
                  <td>{machine.stages.length} Stages ({machine.gearRatio})</td>
                  <td>
                    <StatusBadge
                      status={machine.status}
                      label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'}
                      isSimulated={true}
                    />
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`#/machines/${machine.id}`)}
                    >
                      Profile & Detail
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

