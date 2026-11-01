import React, { useState, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import Icon from '../components/common/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * SettingsPage: Authenticated user details, factory authorization boundaries,
 * manager-only user directory, and backend diagnostics.
 */
export default function SettingsPage({ apiStatus, onRefreshApi }) {
  const { user, logout } = useAuth();
  const [factoryUsers, setFactoryUsers] = useState([]);
  const [adminError, setAdminError] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadFactoryUsers() {
      // Only fetch if manager
      if (user?.role !== USER_ROLES.FACTORY_MANAGER) {
        setAdminError('Manager permissions required. Server-enforced role boundary.');
        return;
      }

      setLoadingUsers(true);
      try {
        const res = await fetch(`${API_BASE}/admin/factory-users`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });

        const data = await res.json();
        if (res.ok && isMounted) {
          setFactoryUsers(data.users || []);
          setAdminError(null);
        } else if (isMounted) {
          setAdminError(data.message || `HTTP ${res.status}`);
        }
      } catch (err) {
        if (isMounted) setAdminError(err.message);
      } finally {
        if (isMounted) setLoadingUsers(false);
      }
    }

    loadFactoryUsers();
    return () => {
      isMounted = false;
    };
  }, [user]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Factory Settings & User Access Scope</h1>
          <p className="page-subtitle">
            Authenticated factory authorization boundaries, user role matrix, and backend service connectivity.
          </p>
        </div>
      </div>

      {/* Scope Details Card */}
      <div className="grid-two-col">
        <Card
          title="Active Factory Organization Scope"
          subtitle="Hierarchical multi-tenant scoping boundary enforced by API middleware"
          badge={<StatusBadge status="info" label="ACTIVE FACTORY" />}
        >
          <div className="kv-list">
            <div className="kv-item">
              <span className="kv-key">Organization</span>
              <span className="kv-val">{user?.organizationId?.name || 'Apex Industrial Manufacturing'}</span>
            </div>
            <div className="kv-item">
              <span className="kv-key">Factory Plant</span>
              <span className="kv-val">{user?.factoryId?.name || 'Detroit Powertrain Plant #2'}</span>
            </div>
            <div className="kv-item">
              <span className="kv-key">Factory Code</span>
              <span className="kv-val mono-code">{user?.factoryId?.code || 'DETROIT_02'}</span>
            </div>
            <div className="kv-item">
              <span className="kv-key">Location</span>
              <span className="kv-val">{user?.factoryId?.location || 'Detroit, MI, USA'}</span>
            </div>
          </div>
        </Card>

        <Card
          title="Active User Session"
          subtitle="Authenticated session details loaded from server"
          badge={<StatusBadge status="healthy" label="AUTHENTICATED" />}
          action={
            <Button variant="outline" size="sm" onClick={logout}>
              Sign Out
            </Button>
          }
        >
          <div className="kv-list">
            <div className="kv-item">
              <span className="kv-key">Full Name</span>
              <span className="kv-val">{user?.fullName}</span>
            </div>
            <div className="kv-item">
              <span className="kv-key">Email / Username</span>
              <span className="kv-val mono-code">{user?.email}</span>
            </div>
            <div className="kv-item">
              <span className="kv-key">System Role</span>
              <span className="kv-val mono-code text-accent">{user?.role}</span>
            </div>
            <div className="kv-item">
              <span className="kv-key">Assigned Equipment</span>
              <span className="kv-val mono-code">
                {user?.role === USER_ROLES.FACTORY_MANAGER
                  ? 'All factory machines (Manager scope)'
                  : (user?.assignedMachines || []).map((m) => m.code || m.name || m).join(', ') || 'None assigned'}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Manager Only Factory User Directory */}
      <Card
        title="Factory User Accounts (Manager Directory)"
        subtitle="Endpoint /api/admin/factory-users is protected by requireManager middleware."
        badge={
          user?.role === USER_ROLES.FACTORY_MANAGER ? (
            <StatusBadge status="healthy" label="MANAGER AUTHORIZED" />
          ) : (
            <StatusBadge status="warning" label="RESTRICTED (403)" />
          )
        }
      >
        {user?.role !== USER_ROLES.FACTORY_MANAGER ? (
          <div className="login-error-alert" role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Icon name="shield" size={16} color="#dc2626" />
            <span>
              Access Restricted: The user management directory is restricted to Factory Managers. Non-manager roles receive a 403 Forbidden from the API.
            </span>
          </div>
        ) : loadingUsers ? (
          <p className="text-secondary">Loading factory user directory from API...</p>
        ) : adminError ? (
          <p className="text-secondary">Error: {adminError}</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Assigned Equipment</th>
                </tr>
              </thead>
              <tbody>
                {factoryUsers.map((u) => (
                  <tr key={u._id}>
                    <td className="table-primary-text">{u.fullName}</td>
                    <td><span className="mono-code">{u.email}</span></td>
                    <td>
                      <span className="mono-code text-accent">{u.role}</span>
                    </td>
                    <td>
                      {(u.assignedMachines || []).map((m) => m.code || m).join(', ') || (u.role === 'factory_manager' ? 'All Factory Assets' : 'None')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Role-Based Access Control Architecture */}
      <Card
        title="Role-Based Access Enforcement Matrix"
        subtitle="Security Model: Access control is enforced on the server for all REST endpoints; hiding a UI button does not count as access control."
      >
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Role Key</th>
                <th scope="col">Display Name</th>
                <th scope="col">Scope of Authority</th>
                <th scope="col">Machine Access Bounds</th>
                <th scope="col">Write Permissions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="mono-code">{USER_ROLES.FACTORY_MANAGER}</span></td>
                <td className="table-primary-text">Factory Manager</td>
                <td>Factory-wide</td>
                <td>All machines within factory scope</td>
                <td>Full CRUD (users, machines, alerts, reports)</td>
              </tr>
              <tr>
                <td><span className="mono-code">{USER_ROLES.TECHNICIAN}</span></td>
                <td className="table-primary-text">Technician</td>
                <td>Factory / Assigned Equipment</td>
                <td>Assigned gearbox units only</td>
                <td>Upload datasets, acknowledge alerts, log notes</td>
              </tr>
              <tr>
                <td><span className="mono-code">{USER_ROLES.VIEWER}</span></td>
                <td className="table-primary-text">Viewer</td>
                <td>Assigned Sites</td>
                <td>Assigned machines only</td>
                <td>Read-only (No uploads, no alert changes)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Backend API Runtime & Diagnostics */}
      <Card
        title="Backend API Configuration & Diagnostic Health"
        subtitle="Real-time connectivity to Express backend and MongoDB persistence layer"
        badge={
          <StatusBadge
            status={apiStatus?.status === 'healthy' ? 'healthy' : 'warning'}
            label={apiStatus?.status === 'healthy' ? 'API RESPONSIVE' : 'STANDALONE MODE'}
            isSimulated={false}
          />
        }
        action={
          <Button variant="secondary" size="sm" onClick={onRefreshApi}>
            Refresh API Health
          </Button>
        }
      >
        <div className="kv-list">
          <div className="kv-item">
            <span className="kv-key">Backend Service</span>
            <span className="kv-val">{apiStatus?.service || 'Express API (Offline)'}</span>
          </div>
          <div className="kv-item">
            <span className="kv-key">API Version & Phase</span>
            <span className="kv-val">{apiStatus?.phase || 'Phase 3 - Auth & Scoping'}</span>
          </div>
          <div className="kv-item">
            <span className="kv-key">Server Uptime</span>
            <span className="kv-val">{apiStatus?.uptimeSeconds != null ? `${apiStatus.uptimeSeconds}s` : 'N/A'}</span>
          </div>
          <div className="kv-item">
            <span className="kv-key">MongoDB State</span>
            <span className="kv-val" style={{ color: apiStatus?.database?.hasActiveConnection ? 'var(--status-healthy)' : 'var(--status-warning)' }}>
              {apiStatus?.database?.readyStateLabel || 'Disconnected / Standalone'}
            </span>
          </div>
          <div className="kv-item">
            <span className="kv-key">Raw Dataset Storage Adapter</span>
            <span className="kv-val mono-code">Local Filesystem (./uploads)</span>
          </div>
        </div>

        {apiStatus && (
          <div className="json-preview" style={{ marginTop: '1rem' }}>
            <pre>{JSON.stringify(apiStatus, null, 2)}</pre>
          </div>
        )}
      </Card>
    </div>
  );
}
