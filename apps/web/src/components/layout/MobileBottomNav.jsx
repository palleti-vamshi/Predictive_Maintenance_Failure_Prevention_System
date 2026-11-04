import React from 'react';
import { ROUTES, useRouter } from '../../router/Router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';
import Icon from '../common/Icon.jsx';

/**
 * MobileBottomNav
 * Touch-optimized bottom navigation bar for mobile viewports,
 * matching UX Pilot Page 5 specifications: My Work / Overview, Machines, Alerts, Profile.
 */
export default function MobileBottomNav() {
  const { user } = useAuth();
  const { routeKey, navigate } = useRouter();

  const isTech = user?.role === USER_ROLES.TECHNICIAN;

  const tabs = isTech
    ? [
        {
          key: 'maintenance',
          label: 'My Work',
          hash: ROUTES.MAINTENANCE,
          icon: 'wrench'
        },
        {
          key: 'machines',
          label: 'Machines',
          hash: ROUTES.MACHINES,
          icon: 'machine'
        },
        {
          key: 'alerts',
          label: 'Alerts',
          hash: ROUTES.ALERTS,
          icon: 'alert'
        },
        {
          key: 'settings',
          label: 'Profile',
          hash: ROUTES.SETTINGS,
          icon: 'user'
        }
      ]
    : [
        {
          key: 'overview',
          label: 'Overview',
          hash: ROUTES.OVERVIEW,
          icon: 'grid'
        },
        {
          key: 'machines',
          label: 'Machines',
          hash: ROUTES.MACHINES,
          icon: 'machine'
        },
        {
          key: 'alerts',
          label: 'Alerts',
          hash: ROUTES.ALERTS,
          icon: 'alert'
        },
        {
          key: 'maintenance',
          label: 'Work',
          hash: ROUTES.MAINTENANCE,
          icon: 'wrench'
        }
      ];

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
      {tabs.map((tab) => {
        const isActive =
          routeKey === tab.key ||
          (tab.key === 'machines' && routeKey === 'machine_detail');

        return (
          <button
            key={tab.key}
            type="button"
            className={`mobile-bottom-tab ${isActive ? 'mobile-tab-active' : ''}`}
            onClick={() => navigate(tab.hash)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              <Icon
                name={tab.icon}
                size={20}
                color={isActive ? 'var(--primary)' : 'var(--text-muted)'}
              />
            </span>
            <span className="mobile-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
