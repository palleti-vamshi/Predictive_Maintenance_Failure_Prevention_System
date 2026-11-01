import React from 'react';

/**
 * Reusable Status Badge with accessible semantics and high contrast.
 * Supported variants: 'healthy', 'warning', 'critical', 'info', 'demo'
 */
export default function StatusBadge({ status = 'info', label, isSimulated = false, className = '' }) {
  const normStatus = status?.toLowerCase() || 'info';
  
  // Choose badge style class
  const badgeClasses = {
    healthy: 'badge-healthy',
    warning: 'badge-warning',
    critical: 'badge-critical',
    info: 'badge-info',
    demo: 'badge-demo'
  };

  const badgeClass = badgeClasses[normStatus] || 'badge-info';
  const displayLabel = label || normStatus.toUpperCase();

  return (
    <span
      className={`badge ${badgeClass} ${className}`}
      role="status"
      aria-label={`${displayLabel}${isSimulated ? ' (Simulated)' : ''}`}
    >
      <span className="badge-dot" aria-hidden="true" />
      <span>{displayLabel}</span>
      {isSimulated && <span className="badge-subtag" aria-hidden="true">DEMO DATA</span>}
    </span>
  );
}

