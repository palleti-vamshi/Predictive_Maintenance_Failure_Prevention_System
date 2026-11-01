import React from 'react';

/**
 * LoadingSkeleton component for accessible visual loading placeholders.
 */
export default function LoadingSkeleton({ lines = 3, height = '20px', className = '' }) {
  return (
    <div className={`skeleton-container ${className}`} aria-busy="true" aria-label="Loading content...">
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={idx}
          className="skeleton-line"
          style={{
            height,
            width: idx === lines - 1 && lines > 1 ? '70%' : '100%',
            marginBottom: idx === lines - 1 ? 0 : '8px'
          }}
        />
      ))}
    </div>
  );
}

