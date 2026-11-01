import React from 'react';
import StatusBadge from './StatusBadge.jsx';

/**
 * MetricSummary: displays engineering values with physical units and explicit status semantics.
 * Never creates uncalibrated percentage "health scores" or fake live telemetry.
 */
export default function MetricSummary({
  label,
  value,
  unit = '',
  status = 'info',
  sublabel = '',
  delta = null,
  isSimulated = false,
  className = ''
}) {
  const statusColors = {
    healthy: 'var(--status-healthy)',
    warning: 'var(--status-warning)',
    critical: 'var(--status-critical)',
    info: 'var(--text-accent)',
    demo: 'var(--status-demo)'
  };

  const accentColor = statusColors[status] || 'var(--text-accent)';

  return (
    <div className={`metric-card ${className}`}>
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        {isSimulated && (
          <span className="metric-sim-badge" title="Demo / benchmark dataset specimen">
            DEMO DATA
          </span>
        )}
      </div>

      <div className="metric-value-row">
        <span className="metric-val" style={{ color: accentColor }}>
          {value}
        </span>
        {unit && <span className="metric-unit">{unit}</span>}
      </div>

      {(sublabel || delta) && (
        <div className="metric-footer">
          {sublabel && <span className="metric-sublabel">{sublabel}</span>}
          {delta && (
            <span
              className={`metric-delta ${delta.startsWith('+') ? 'delta-up' : 'delta-down'}`}
            >
              {delta}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

