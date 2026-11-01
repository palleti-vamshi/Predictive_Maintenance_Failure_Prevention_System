import React from 'react';

/**
 * Reusable Industrial Empty State component with clear operational guidance.
 */
export default function EmptyState({
  title,
  description,
  icon = null,
  action = null,
  phaseNote = null,
  className = ''
}) {
  return (
    <div className={`empty-state ${className}`}>
      <div className="empty-state-icon" aria-hidden="true">
        {icon || (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        )}
      </div>

      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-desc">{description}</p>

      {phaseNote && (
        <div className="empty-state-phase-note">
          <span className="phase-indicator">Planned Architecture:</span> {phaseNote}
        </div>
      )}

      {action && <div className="empty-state-actions">{action}</div>}
    </div>
  );
}

