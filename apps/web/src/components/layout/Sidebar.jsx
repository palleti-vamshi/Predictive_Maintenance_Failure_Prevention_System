import React from 'react';
import { NAV_ITEMS, useRouter } from '../../router/Router.jsx';
import Icon from '../common/Icon.jsx';

/**
 * Sidebar navigation drawer with accessible route indicators and clean vector icons.
 */
export default function Sidebar({ mobileNavOpen, onCloseMobileNav }) {
  const { routeKey, navigate } = useRouter();

  const handleNavClick = (hash) => {
    navigate(hash);
    if (onCloseMobileNav) {
      onCloseMobileNav();
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobileNav}
          aria-hidden="true"
        />
      )}

      <aside className={`app-sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        {/* Navigation Item List */}
        <nav className="sidebar-nav" aria-label="Main Navigation">
          <div className="sidebar-section-title">Navigation</div>
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.key === routeKey ||
                (item.key === 'machines' && routeKey === 'machine_detail');

              return (
                <li key={item.key} className="nav-item">
                  <button
                    type="button"
                    onClick={() => handleNavClick(item.hash)}
                    className={`nav-link ${isActive ? 'nav-link-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      <Icon name={item.icon} size={18} color={isActive ? 'var(--primary)' : 'var(--text-secondary)'} />
                    </span>
                    <div className="nav-content">
                      <span className="nav-title">{item.label}</span>
                      <span className="nav-desc">{item.description}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Clean Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-info-card">
            <div className="sidebar-info-title">
              <Icon name="shield" size={14} color="var(--primary)" />
              <span>Condition Guard</span>
            </div>
            <p className="sidebar-info-text">
              Multi-signal telemetry & regime-aware anomaly detection.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

