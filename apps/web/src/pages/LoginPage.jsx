import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/common/Button.jsx';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';

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
      {/* Top Banner */}
      <div className="demo-global-banner">
        <span className="banner-tag" aria-hidden="true">AUTHENTICATED ACCESS</span>
        <span>
          Phase 9 Industrial Command Center • Server-enforced sessions & scoped factory access.
        </span>
      </div>

      <div className="login-center-wrapper">
        <div className="login-box">
          {/* Brand Header */}
          <div className="login-brand-header">
            <span className="brand-logo-icon" aria-hidden="true">⚙️</span>
            <div>
              <h1 className="login-brand-title">Predictive Maintenance System</h1>
              <p className="login-brand-subtitle">
                Mechanical Systems Condition Monitoring & Failure Prevention
              </p>
            </div>
          </div>

          <Card
            title="Authorized Factory Login"
            subtitle="Sign in with your organization or factory credentials"
            badge={<StatusBadge status="info" label="SECURE SESSION" />}
          >
            {errorMessage && (
              <div className="login-error-alert" role="alert">
                <span className="error-icon" aria-hidden="true">⚠️</span>
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
                  className="form-select"
                  autoComplete="username"
                  placeholder="e.g. tech@detroit.factory"
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
                  className="form-select"
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

            {/* Development Quick-Login Drawer (Rendered strictly in development builds) */}
            {import.meta.env.DEV && (
              <div className="dev-demo-accounts-box">
                <div className="dev-accounts-header">
                  <span className="dev-tag">DEVELOPMENT ONLY</span>
                  <span className="dev-title">Quick Demo Login</span>
                </div>
                <p className="dev-accounts-desc">
                  Log in as a seeded local prototype account to test role permissions and factory access boundaries:
                </p>

                <div className="dev-buttons-grid">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleQuickLogin('manager')}
                    disabled={loading}
                    title="Full management of Detroit Plant #2 (users, machines, alerts)"
                  >
                    🏢 Factory Manager (Sarah Vance)
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleQuickLogin('technician')}
                    disabled={loading}
                    title="Assigned to GB-104 only; write notes; no user admin"
                  >
                    🔧 Field Technician (Alex Mercer)
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleQuickLogin('viewer')}
                    disabled={loading}
                    title="Read-only access to assigned assets"
                  >
                    👁️ Factory Viewer (David Sterling)
                  </Button>
                </div>

                <div className="dev-notice-text">
                  Passwords seeded via <code>npm run seed</code>. User IDs from different factories cannot access each other's data.
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

