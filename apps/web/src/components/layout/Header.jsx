import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useRouter, ROUTES } from '../../router/Router.jsx';
import Icon from '../common/Icon.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';

/**
 * Slim Top Bar (UX Pilot reference).
 * Features active factory context switcher, demo data label, global search bar,
 * and live system/alert indicators.
 */
export default function Header({ onToggleMobileNav, mobileNavOpen, apiStatus }) {
  const { user, switchFactory } = useAuth();
  const { navigate } = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const factoryName = user?.factoryId?.name || 'Pune Precision Powertrains Plant #2';

  const handleFactoryChange = async (e) => {
    const newFactoryId = e.target.value;
    if (!newFactoryId || newFactoryId === (user?.factoryId?._id || user?.factoryId)) return;
    const res = await switchFactory(newFactoryId);
    if (res.success) {
      window.location.reload();
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;

    if (query.startsWith('gb') || query.startsWith('br') || query.startsWith('pm') || query.includes('gear') || query.includes('machine')) {
      navigate(ROUTES.MACHINES);
    } else if (query.startsWith('al-') || query.includes('alert')) {
      navigate(ROUTES.ALERTS);
    } else if (query.startsWith('wo-') || query.includes('work') || query.includes('maint')) {
      navigate(ROUTES.MAINTENANCE);
    } else if (query.startsWith('an-') || query.includes('analysis')) {
      navigate(ROUTES.ANALYSIS);
    } else {
      navigate(ROUTES.MACHINES);
    }
  };

  return (
    <header className="app-header-bar">
      <div className="header-left">
        {/* Mobile menu toggle */}
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={onToggleMobileNav}
          aria-label={mobileNavOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
          aria-expanded={mobileNavOpen}
        >
          <Icon name={mobileNavOpen ? 'close' : 'menu'} size={18} color="#0f172a" />
        </button>

        {/* Factory Scoping Context */}
        <div className="header-factory-context">
          {user?.role === USER_ROLES.FACTORY_MANAGER && user?.authorizedFactories?.length > 1 ? (
            <div className="factory-dropdown-wrapper">
              <Icon name="factory" size={14} color="var(--primary)" />
              <select
                className="factory-dropdown-select"
                value={user?.factoryId?._id || user?.factoryId || ''}
                onChange={handleFactoryChange}
                aria-label="Active factory selector"
              >
                {user.authorizedFactories.map((f) => {
                  const id = f._id || f;
                  const name = f.name || f.code || 'Factory';
                  return (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  );
                })}
              </select>
              <Icon name="chevronDown" size={12} color="var(--text-tertiary)" />
            </div>
          ) : (
            <div className="factory-display-pill">
              <Icon name="factory" size={14} color="var(--primary)" />
              <span className="factory-display-name">{factoryName}</span>
            </div>
          )}
          <span className="demo-data-badge">Demo data</span>
          <span className="header-context-note">Records created by seed flow</span>
        </div>
      </div>

      {/* Global Search Bar (Center) */}
      <div className="header-center">
        <form onSubmit={handleSearchSubmit} className="header-search-form" role="search">
          <Icon name="search" size={15} color="var(--text-muted)" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search machines, alerts, work orders..."
            className="header-search-input"
            aria-label="Global search across machines, alerts, and work orders"
          />
        </form>
      </div>

      {/* Right Utility Actions */}
      <div className="header-right">
        {/* Quick Alerts Shortcut */}
        <button
          type="button"
          className="header-alerts-btn"
          onClick={() => navigate(ROUTES.ALERTS)}
          title="View active condition alerts"
        >
          <Icon name="bell" size={15} color="#d97706" />
          <span className="header-alerts-text">Alerts</span>
        </button>

        {/* API Server Online Indicator */}
        <div
          className={`api-indicator ${apiStatus?.hasActiveConnection ? 'api-online' : 'api-degraded'}`}
          title={apiStatus?.database?.note || 'API status check'}
        >
          <span className="api-dot" aria-hidden="true" />
          <span className="api-text">
            {apiStatus?.hasActiveConnection ? 'Online' : 'Degraded'}
          </span>
        </div>
      </div>
    </header>
  );
}
