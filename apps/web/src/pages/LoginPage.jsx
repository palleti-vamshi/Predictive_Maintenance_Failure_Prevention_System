import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/common/Button.jsx';
import Icon from '../components/common/Icon.jsx';

/**
 * Clean, Uncluttered Industrial Sign-In Page for MechGuard AI
 * Features a compact centered card with authentic workspace context,
 * high-contrast accessible forms, and server-verified role authentication.
 */
export default function LoginPage() {
  const { login, loading, authError } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      setLocalError('Please enter your work email or username.');
      return;
    }
    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    const res = await login(trimmedIdentifier, password);
    if (!res.success) {
      setLocalError(res.message);
    }
  };

  const errorMessage = localError || authError;

  return (
    <div className="login-page-root">
      <div className="login-compact-card" role="main" aria-label="Sign in to MechGuard AI">
        {/* Brand Header */}
        <div className="login-brand-header">
          <div className="login-brand-badge" aria-hidden="true">
            <Icon name="brandMark" size={28} color="#ffffff" />
          </div>
          <div className="login-brand-meta">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="login-brand-logo-text">MechGuard AI</span>
              <span className="login-brand-pill">Mechanical Intelligence</span>
            </div>
            <p className="login-product-desc">
              AI-Based Predictive Maintenance and Failure Prevention System
            </p>
          </div>
        </div>

        {/* Workspace Context Section */}
        <div className="login-context-box">
          <div className="login-context-header">
            <Icon name="info" size={14} color="var(--primary)" />
            <span className="login-context-title">Industrial Workspace</span>
          </div>
          <p className="login-context-desc">
            Authorized access for Factory Managers and Maintenance Technicians. Role permissions, factory scopes, and equipment access are securely resolved from your account.
          </p>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="login-error-alert" role="alert" aria-live="assertive">
            <Icon name="alert" size={16} color="var(--status-critical)" />
            <div className="login-error-text">
              <strong>Authentication Failed</strong>
              <div>{errorMessage}</div>
            </div>
          </div>
        )}

        {/* Sign-In Form */}
        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="form-group">
            <label htmlFor="login-identifier" className="form-label">
              Work Email or Username
            </label>
            <input
              id="login-identifier"
              type="text"
              name="identifier"
              autoComplete="username"
              className="form-input"
              placeholder="e.g. manager@pune.bharatdynamics.demo"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (localError) setLocalError(null);
              }}
              disabled={loading}
              required
              aria-required="true"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="login-password" className="form-label">
                Security Password
              </label>
            </div>
            <div className="password-input-wrapper">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                className="form-input password-input-field"
                placeholder="Enter your security password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (localError) setLocalError(null);
                }}
                disabled={loading}
                required
                aria-required="true"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="login-submit-btn"
            loading={loading}
            icon={!loading ? 'lock' : null}
          >
            {loading ? 'Authenticating...' : 'Sign In to Workspace'}
          </Button>
        </form>

        {/* Security & Organization Footer */}
        <div className="login-card-footer">
          <span className="login-security-dot" aria-hidden="true" />
          <span>Bharat Industrial Dynamics • Multi-Plant Authorization</span>
        </div>
      </div>
    </div>
  );
}
