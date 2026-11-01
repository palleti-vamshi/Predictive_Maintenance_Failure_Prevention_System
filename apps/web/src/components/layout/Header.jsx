import React from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import Button from '../common/Button.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';

const ROLE_DISPLAY_NAMES = {
  [USER_ROLES.FACTORY_MANAGER]: 'Factory Manager',
  [USER_ROLES.TECHNICIAN]: 'Field Technician',
  [USER_ROLES.VIEWER]: 'Factory Viewer'
};

/**
 * Header component displaying authenticated user, factory scope, and logout control.
 */
export default function Header({ onToggleMobileNav, mobileNavOpen, apiStatus }) {
  const { user, logout } = useAuth();

  const factoryName = user?.factoryId?.name || 'Assigned Factory';
  const userFullName = user?.fullName || user?.username || 'User';
  const roleDisplay = ROLE_DISPLAY_NAMES[user?.role] || user?.role || 'Technician';
  const userInitials = userFullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

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
          <span className="hamburger-icon" aria-hidden="true">
            {mobileNavOpen ? '✕' : '☰'}
          </span>
        </button>

        <div className="brand-lockup">
          <span className="brand-logo-icon" aria-hidden="true">⚙️</span>
          <div>
            <div className="brand-title">Predictive Maintenance System</div>
            <div className="brand-subtitle">Mechanical Systems Failure Prevention</div>
          </div>
        </div>
      </div>

      <div className="header-right">
        {/* Factory Scoping Pill */}
        <div className="scope-pill" title="Hierarchical factory access scope">
          <span className="scope-icon" aria-hidden="true">🏢</span>
          <span className="scope-text">{factoryName}</span>
          <span className="demo-tag" aria-hidden="true">ACTIVE SCOPE</span>
        </div>

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
            {apiStatus?.hasActiveConnection ? 'API Online' : 'API Standalone'}
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
