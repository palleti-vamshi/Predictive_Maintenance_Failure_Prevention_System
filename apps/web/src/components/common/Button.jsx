import React from 'react';
import Icon from './Icon.jsx';

/**
 * Reusable Industrial Button Component.
 */
export default function Button({
  children,
  onClick,
  type = 'button',
  variant = 'secondary',
  size = 'md',
  disabled = false,
  loading = false,
  icon = null,
  className = '',
  title,
  ariaLabel
}) {
  const variantClass = `btn-${variant}`;
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';

  const renderIcon = () => {
    if (!icon) return null;
    if (typeof icon === 'string') {
      return <Icon name={icon} size={size === 'sm' ? 14 : 16} />;
    }
    return icon;
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading}
      className={`btn ${variantClass} ${sizeClass} ${className}`}
    >
      {loading ? (
        <span className="spinner" aria-hidden="true" />
      ) : icon ? (
        <span className="btn-icon" aria-hidden="true">{renderIcon()}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

