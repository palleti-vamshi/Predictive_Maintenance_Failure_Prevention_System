import React, { useState, useEffect, useMemo } from 'react';
import { ROUTES, useRouter } from '../../router/Router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';
import Icon from '../common/Icon.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Dark Navy Left Navigation Bar (UX Pilot reference).
 * Features grouped sections (OPERATE, DATA, RESEARCH), active page indicator,
 * live counts for alerts and maintenance, and user profile drawer.
 */
export default function Sidebar({ mobileNavOpen, onCloseMobileNav }) {
  const { user, logout } = useAuth();
  const { routeKey, navigate } = useRouter();

  const isTech = user?.role === USER_ROLES.TECHNICIAN;
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;

  // Live counts for open items
  const [counts, setCounts] = useState({
    alerts: null,
    workOrders: null
  });

  useEffect(() => {
    let isMounted = true;
    async function fetchBadgeCounts() {
      try {
        const [alertsRes, ordersRes] = await Promise.all([
          fetch(`${API_BASE}/alerts`, { credentials: 'include', headers: { Accept: 'application/json' } }),
          fetch(`${API_BASE}/work-orders`, { credentials: 'include', headers: { Accept: 'application/json' } })
        ]);

        if (alertsRes.ok && isMounted) {
          const aData = await alertsRes.json();
          const openAlerts = (aData.alerts || []).filter((a) => a.status === 'open' || a.status === 'acknowledged');
          setCounts((prev) => ({ ...prev, alerts: openAlerts.length }));
        }

        if (ordersRes.ok && isMounted) {
          const oData = await ordersRes.json();
          const openOrders = (oData.orders || []).filter(
            (o) => o.status !== 'closed' && o.status !== 'completed' && o.status !== 'approved'
          );
          setCounts((prev) => ({ ...prev, workOrders: openOrders.length }));
        }
      } catch (err) {
        // Non-blocking counts fetch
      }
    }

    fetchBadgeCounts();
    const interval = setInterval(fetchBadgeCounts, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleNavClick = (hash) => {
    navigate(hash);
    if (onCloseMobileNav) {
      onCloseMobileNav();
    }
  };

  // Nav Groups matching UX Pilot layout
  const operateItems = useMemo(() => {
    if (isTech) {
      return [
        {
          key: 'maintenance',
          label: 'My Work',
          hash: ROUTES.MAINTENANCE,
          icon: 'wrench',
          badge: counts.workOrders ?? 1
        },
        {
          key: 'machines',
          label: 'Assigned Machines',
          hash: ROUTES.MACHINES,
          icon: 'machine'
        },
        {
          key: 'alerts',
          label: 'Condition Alerts',
          hash: ROUTES.ALERTS,
          icon: 'alert',
          badge: counts.alerts ?? 4
        }
      ];
    }
    return [
      {
        key: 'overview',
        label: 'Overview',
        hash: ROUTES.OVERVIEW,
        icon: 'dashboard'
      },
      {
        key: 'maintenance',
        label: 'Maintenance',
        hash: ROUTES.MAINTENANCE,
        icon: 'wrench',
        badge: counts.workOrders ?? 3
      },
      {
        key: 'alerts',
        label: 'Alerts',
        hash: ROUTES.ALERTS,
        icon: 'alert',
        badge: counts.alerts ?? 5
      }
    ];
  }, [isTech, counts]);

  const dataItems = useMemo(() => {
    if (isTech) {
      return [
        {
          key: 'datasets',
          label: 'Upload Telemetry',
          hash: ROUTES.DATASETS_UPLOAD,
          icon: 'dataset'
        }
      ];
    }
    return [
      {
        key: 'machines',
        label: 'Factories & machines',
        hash: ROUTES.MACHINES,
        icon: 'machine'
      },
      {
        key: 'datasets',
        label: 'Datasets',
        hash: ROUTES.DATASETS_UPLOAD,
        icon: 'dataset'
      },
      {
        key: 'analysis',
        label: 'Analysis results',
        hash: ROUTES.ANALYSIS,
        icon: 'analysis'
      }
    ];
  }, [isTech]);

  const researchItems = useMemo(() => {
    return [
      {
        key: 'research',
        label: 'Models & research',
        hash: ROUTES.RESEARCH,
        icon: 'research'
      },
      {
        key: 'audit',
        label: 'Audit Trail',
        hash: ROUTES.AUDIT,
        icon: 'book'
      }
    ];
  }, []);

  const userFullName = user?.fullName || user?.username || 'Priya Raman';
  const roleDisplay = isManager ? 'Manager' : isTech ? 'Technician' : 'Viewer';
  const factoryName = user?.factoryId?.name || 'Pune Precision Powertrains Plant #2';
  const userInitials = userFullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const renderNavGroup = (title, items) => (
    <div className="sidebar-group" key={title}>
      <div className="sidebar-section-title">{title}</div>
      <ul className="sidebar-nav-list">
        {items.map((item) => {
          const isActive =
            item.key === routeKey ||
            (item.key === 'machines' && routeKey === 'machine_detail');

          return (
            <li key={item.key} className="sidebar-nav-item">
              <button
                type="button"
                onClick={() => handleNavClick(item.hash)}
                className={`sidebar-nav-link ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <div className="sidebar-nav-link-left">
                  <Icon
                    name={item.icon}
                    size={17}
                    color={isActive ? '#ffffff' : '#94a3b8'}
                  />
                  <span className="sidebar-nav-label">{item.label}</span>
                </div>
                {item.badge != null && (
                  <span className={`sidebar-badge ${isActive ? 'sidebar-badge-accent' : ''}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

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

      <aside className={`app-sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`} aria-label="Desktop Navigation">
        {/* Top Brand Lockup (Dark Navy) */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-badge">
            <Icon name="brandMark" size={20} color="#ffffff" />
          </div>
          <div>
            <div className="sidebar-brand-title">MechGuard AI</div>
            <div className="sidebar-brand-subtitle">Predictive Maintenance</div>
          </div>
        </div>

        {/* Grouped Navigation */}
        <nav className="sidebar-nav" aria-label="Main Navigation">
          {renderNavGroup('OPERATE', operateItems)}
          {renderNavGroup('DATA', dataItems)}
          {renderNavGroup('RESEARCH', researchItems)}
        </nav>

        {/* Bottom User Profile Section in Dark Navy */}
        <div className="sidebar-user-profile">
          <div className="sidebar-profile-row">
            <div className="sidebar-avatar" aria-hidden="true">
              {userInitials}
            </div>
            <div className="sidebar-user-meta">
              <div className="sidebar-user-name">{userFullName}</div>
              <div className="sidebar-role-badge">{roleDisplay}</div>
            </div>
          </div>

          <div className="sidebar-scope-text" title={`${factoryName} (Demo data)`}>
            <span className="sidebar-scope-dot" />
            <span className="sidebar-scope-name">{factoryName}</span>
            <span className="sidebar-demo-tag">Demo data</span>
          </div>

          <button
            type="button"
            onClick={logout}
            className="sidebar-signout-btn"
            title="Sign out of factory session"
          >
            <Icon name="logOut" size={14} color="#94a3b8" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
