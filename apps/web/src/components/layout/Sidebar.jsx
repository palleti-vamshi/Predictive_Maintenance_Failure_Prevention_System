import React, { useMemo } from 'react';
import { NAV_ITEMS, ROUTES, useRouter } from '../../router/Router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';
import Icon from '../common/Icon.jsx';

/**
 * Sidebar navigation drawer with role-tailored navigation items,
 * accessible route indicators, and clean vector icons.
 */
export default function Sidebar({ mobileNavOpen, onCloseMobileNav }) {
  const { user } = useAuth();
  const { routeKey, navigate } = useRouter();

  const isTech = user?.role === USER_ROLES.TECHNICIAN;

  const navigationItems = useMemo(() => {
    if (isTech) {
      return [
        {
          key: 'maintenance',
          label: 'My Work Orders',
          hash: ROUTES.MAINTENANCE,
          icon: 'wrench',
          description: 'Assigned maintenance & reports'
        },
        {
          key: 'machines',
          label: 'Assigned Machines',
          hash: ROUTES.MACHINES,
          icon: 'machine',
          description: 'Equipment condition & telemetry'
        },
        {
          key: 'alerts',
          label: 'Condition Alerts',
          hash: ROUTES.ALERTS,
          icon: 'alert',
          description: 'Evidence-based warnings & notes'
        },
        {
          key: 'datasets',
          label: 'Upload Telemetry',
          hash: ROUTES.DATASETS_UPLOAD,
          icon: 'dataset',
          description: 'Operational run CSV ingestion'
        },
        {
          key: 'settings',
          label: 'Factory Scope',
          hash: ROUTES.SETTINGS,
          icon: 'settings',
          description: 'Plant authorization details'
        }
      ];
    }
    return NAV_ITEMS;
  }, [isTech]);

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
          <div className="sidebar-section-title">
            {isTech ? 'Field Technician Desk' : 'Plant Navigation'}
          </div>
          <ul className="nav-list">
            {navigationItems.map((item) => {
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

