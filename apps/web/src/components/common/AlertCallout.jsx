import React from 'react';
import StatusBadge from './StatusBadge.jsx';

/**
 * Reusable Alert Callout for warnings, critical alarms, and system explanations.
 */
export default function AlertCallout({
  severity = 'info',
  title,
  description,
  timestamp,
  contributingSignals = [],
  action = null,
  isSimulated = true,
  className = ''
}) {
  const borderClasses = {
    critical: 'callout-critical',
    warning: 'callout-warning',
    info: 'callout-info',
    demo: 'callout-demo'
  };

  const calloutClass = borderClasses[severity] || 'callout-info';

  return (
    <div className={`alert-callout ${calloutClass} ${className}`} role="alert">
      <div className="alert-callout-header">
        <div className="alert-title-group">
          <StatusBadge status={severity} label={severity.toUpperCase()} isSimulated={isSimulated} />
          <h3 className="alert-callout-title">{title}</h3>
        </div>
        {timestamp && <span className="alert-timestamp">{timestamp}</span>}
      </div>

      {description && <p className="alert-callout-desc">{description}</p>}

      {contributingSignals.length > 0 && (
        <div className="alert-signals-box">
          <span className="alert-signals-heading">Contributing Sensor Signals:</span>
          <div className="alert-signals-list">
            {contributingSignals.map((item, idx) => (
              <div key={idx} className="alert-signal-pill">
                <span className="signal-name">{item.signal}</span>
                <span className="signal-val">{item.value}</span>
                {item.delta && <span className="signal-delta">({item.delta})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {action && <div className="alert-callout-actions">{action}</div>}
    </div>
  );
}

