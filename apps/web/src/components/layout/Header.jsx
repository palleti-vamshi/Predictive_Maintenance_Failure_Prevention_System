import React from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import Button from '../common/Button.jsx';
import Icon from '../common/Icon.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';

const ROLE_DISPLAY_NAMES = {
  [USER_ROLES.FACTORY_MANAGER]: 'Factory Manager',
  [USER_ROLES.TECHNICIAN]: 'Field Technician',
  [USER_ROLES.VIEWER]: 'Factory Viewer'
};

/**
 * Header component displaying authenticated user, factory scope, and logout control.
 * Styled in clean light-lavender & white aesthetic with crisp SVG icons.
 */
export default function Header({ onToggleMobileNav, mobileNavOpen, apiStatus }) {
  const { user, logout, switchFactory } = useAuth();

  const factoryName = user?.factoryId?.name || 'Assigned Factory';
  const userFullName = user?.fullName || user?.username || 'User';
  const roleDisplay = ROLE_DISPLAY_NAMES[user?.role] || user?.role || 'Technician';
  const userInitials = userFullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const handleFactoryChange = async (e) => {
    const newFactoryId = e.target.value;
    if (!newFactoryId || newFactoryId === (user?.factoryId?._id || user?.factoryId)) return;
    const res = await switchFactory(newFactoryId);
    if (res.success) {
      window.location.reload();
    }
  };

  return (
    <header className="app-header-bar">
      <div className="header-left">
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={onToggleMobileNav}
          aria-label={mobileNavOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
          aria-expanded={mobileNavOpen}
        >
          <Icon name={mobileNavOpen ? 'close' : 'menu'} size={18} />
        </button>

        <div className="brand-lockup">
          <div className="brand-logo-badge">
            <Icon name="brandMark" size={22} color="#ffffff" />
          </div>
          <div>
            <div className="brand-title">MechGuard AI</div>
            <div className="brand-subtitle">Predictive Maintenance & Failure Prevention</div>
          </div>
        </div>
      </div>

      <div className="header-right">
        {/* Factory Scoping Pill / Interactive Selector */}
        {user?.role === USER_ROLES.FACTORY_MANAGER && user?.authorizedFactories?.length > 1 ? (
          <div className="scope-pill scope-selector" title="Switch active factory demonstration scope">
            <Icon name="factory" size={14} color="var(--primary)" />
            <select
              className="factory-select-dropdown"
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
          <div className="scope-pill" title="Hierarchical factory access scope">
            <Icon name="factory" size={14} color="var(--primary)" />
            <span className="scope-text">{factoryName}</span>
          </div>
        )}

        {/* User Role Profile Pill */}
        <div className="user-profile-pill" title={`Signed in as ${userFullName} (${user?.role})`}>
          <div className="user-avatar" aria-hidden="true">
            {userInitials}
          </div>
          <div className="user-details">
            <span className="user-name">{userFullName}</span>
            <span className="user-role">{roleDisplay}</span>
          </div>
        </div>

        {/* API Server Status Indicator */}
        <div
          className={`api-indicator ${apiStatus?.hasActiveConnection ? 'api-online' : 'api-degraded'}`}
          title={apiStatus?.database?.note || 'API status check'}
        >
          <span className="api-dot" aria-hidden="true" />
          <span className="api-text">
            {apiStatus?.hasActiveConnection ? 'Online' : 'Standalone'}
          </span>
        </div>

        {/* Logout Action Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={logout}
          title="Sign out of factory session"
          className="logout-btn"
        >
          Sign Out
        </Button>
      </div>
    </header>
  );
}
