import React from 'react';
import { NAV_ITEMS, useRouter } from '../../router/Router.jsx';
import { MACHINE_TYPES } from '@predictive-maintenance/shared';

/**
 * Sidebar navigation drawer with accessible route indicators and machine scope info.
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
        {/* Machine Archetype Banner */}
        <div className="sidebar-target-machine">
          <span className="target-label">Target Architecture</span>
          <span className="target-value">Industrial {MACHINE_TYPES.GEARBOX.toUpperCase()}</span>
          <span className="target-stage-note">Planetary & Helical Stages</span>
        </div>

        {/* Navigation Item List */}
        <nav className="sidebar-nav" aria-label="Main Navigation">
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
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
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

        {/* Operational Disclaimer */}
        <div className="sidebar-footer">
          <div className="sim-disclaimer-box">
            <span className="sim-badge" aria-hidden="true">BENCHMARK ENVIRONMENT</span>
            <p className="sim-text">
              Calibrated baseline telemetry & verified benchmark specimens. Seeded data labeled [SIMULATED].
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

