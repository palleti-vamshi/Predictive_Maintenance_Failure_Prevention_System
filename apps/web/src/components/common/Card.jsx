import React from 'react';

/**
 * Reusable Industrial Card Container.
 */
export default function Card({
  title,
  subtitle,
  badge,
  action,
  children,
  footer,
  className = '',
  style = {}
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || subtitle || badge || action) && (
        <div className="card-header">
          <div className="card-header-main">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-desc">{subtitle}</p>}
          </div>
          <div className="card-header-actions">
            {badge}
            {action}
          </div>
        </div>
      )}
      <div className="card-body">
        {children}
      </div>
      {footer && (
        <div className="card-footer">
          {footer}
        </div>
      )}
    </section>
  );
}

