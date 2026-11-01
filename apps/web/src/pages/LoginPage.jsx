import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/common/Button.jsx';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Icon from '../components/common/Icon.jsx';

/**
 * LoginPage: Professional industrial login interface with accessible form controls
 * and development-only demo account quick buttons.
 */
export default function LoginPage() {
  const { login, quickDemoLogin, loading, authError } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!identifier.trim()) {
      setLocalError('Please enter your email or username.');
      return;
    }
    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    const res = await login(identifier.trim(), password);
    if (!res.success) {
      setLocalError(res.message);
    }
  };

  const handleQuickLogin = async (roleType) => {
    setLocalError(null);
    const res = await quickDemoLogin(roleType);
    if (!res.success) {
      setLocalError(res.message);
    }
  };

  const errorMessage = localError || authError;

  return (
    <div className="login-page-root">
      <div className="login-center-wrapper">
        <div className="login-box">
          {/* Brand Header */}
          <div className="login-brand-header">
            <div className="brand-logo-badge" style={{ width: '40px', height: '40px' }}>
              <Icon name="brandMark" size={26} color="#ffffff" />
            </div>
            <div>
              <h1 className="login-brand-title">Presight</h1>
              <p className="login-brand-subtitle">
                Predictive Maintenance & Failure Prevention
              </p>
            </div>
          </div>

          <Card
            title="Authorized Factory Sign In"
            subtitle="Access mechanical telemetry, alerts, and maintenance work orders"
            badge={<StatusBadge status="info" label="SECURE SESSION" />}
          >
            {errorMessage && (
              <div className="login-error-alert" role="alert">
                <Icon name="alert" size={16} color="var(--status-critical)" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-form" noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="user-identifier">
                  Email or Username:
                </label>
                <input
                  id="user-identifier"
                  type="text"
                  className="form-input"
                  autoComplete="username"
                  placeholder="e.g. manager@detroit.factory"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="user-password">
                  Password:
                </label>
                <input
                  id="user-password"
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                className="login-submit-btn"
              >
                Sign In to Factory System
              </Button>
            </form>

            {/* Development Quick-Login Drawer */}
            {import.meta.env.DEV && (
              <div className="dev-demo-accounts-box">
                <div className="dev-accounts-header">
                  <span className="dev-tag">DEVELOPMENT</span>
                  <span className="dev-title">Quick Demo Login</span>
                </div>
                <p className="dev-accounts-desc">
                  Select a seeded prototype account to verify role permissions and scoped factory access:
                </p>

                <div className="dev-buttons-grid">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="factory"
                    onClick={() => handleQuickLogin('manager')}
                    disabled={loading}
                    title="Full management of Detroit Powertrain Plant (fleet, alerts, work orders)"
                  >
                    Factory Manager (Sarah Vance)
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="wrench"
                    onClick={() => handleQuickLogin('technician')}
                    disabled={loading}
                    title="Assigned to GB-104; maintenance work orders and field observations"
                  >
                    Field Technician (Alex Mercer)
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="layer"
                    onClick={() => handleQuickLogin('viewer')}
                    disabled={loading}
                    title="Read-only access to assigned assets"
                  >
                    Factory Viewer (David Sterling)
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

