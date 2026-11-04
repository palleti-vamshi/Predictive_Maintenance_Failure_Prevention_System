import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/common/Button.jsx';
import Icon from '../components/common/Icon.jsx';

/**
 * IndustrialGearboxSchematic
 * Technical vector illustration of a parallel-shaft industrial gearbox transmission
 * with mechanical shaft lines, meshing gears, and transducer monitoring nodes.
 */
function IndustrialGearboxSchematic() {
  return (
    <svg
      viewBox="0 0 440 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="login-schematic-svg"
      aria-hidden="true"
    >
      <defs>
        <pattern id="schematicGrid" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="rgba(124, 58, 237, 0.07)" />
        </pattern>
        <linearGradient id="gearGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Grid Canvas */}
      <rect width="440" height="180" rx="12" fill="url(#schematicGrid)" />

      {/* Gearbox Housing Perimeter */}
      <rect
        x="45"
        y="20"
        width="350"
        height="140"
        rx="12"
        stroke="#d8d2ea"
        strokeWidth="1.5"
        strokeDasharray="5 4"
        fill="rgba(255, 255, 255, 0.75)"
      />

      {/* Input Drive Shaft */}
      <rect x="15" y="58" width="85" height="12" rx="3" fill="#e0e7ff" stroke="#6366f1" strokeWidth="1.5" />
      <text x="18" y="50" fontSize="9" fontWeight="600" fill="#6366f1" fontFamily="sans-serif">
        INPUT DRIVE (RPM)
      </text>

      {/* Pinion Gear (Input Shaft) */}
      <circle cx="150" cy="64" r="38" fill="url(#gearGradient)" stroke="#7c3aed" strokeWidth="2" />
      <circle cx="150" cy="64" r="28" stroke="#a855f7" strokeWidth="1.2" strokeDasharray="3 3" />
      <circle cx="150" cy="64" r="7" fill="#ffffff" stroke="#7c3aed" strokeWidth="2" />
      <line x1="150" y1="22" x2="150" y2="30" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <line x1="150" y1="98" x2="150" y2="106" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <line x1="108" y1="64" x2="116" y2="64" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <line x1="184" y1="64" x2="192" y2="64" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />

      {/* Meshing Driven Gear (Intermediate/Output Shaft) */}
      <circle cx="260" cy="104" r="50" fill="url(#gearGradient)" stroke="#7c3aed" strokeWidth="2" />
      <circle cx="260" cy="104" r="38" stroke="#a855f7" strokeWidth="1.2" strokeDasharray="3 3" />
      <circle cx="260" cy="104" r="9" fill="#ffffff" stroke="#7c3aed" strokeWidth="2" />
      <line x1="260" y1="50" x2="260" y2="58" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <line x1="260" y1="150" x2="260" y2="158" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <line x1="206" y1="104" x2="214" y2="104" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <line x1="306" y1="104" x2="314" y2="104" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />

      {/* Kinematic Mesh Node */}
      <circle cx="202" cy="85" r="4" fill="#dc2626" />
      <text x="210" y="83" fontSize="9" fontWeight="600" fill="#dc2626" fontFamily="sans-serif">
        Mesh Freq (f_m)
      </text>

      {/* Output Driven Shaft */}
      <rect x="260" y="98" width="155" height="12" rx="3" fill="#e0e7ff" stroke="#6366f1" strokeWidth="1.5" />
      <text x="325" y="90" fontSize="9" fontWeight="600" fill="#6366f1" fontFamily="sans-serif">
        OUTPUT TRANSMISSION
      </text>

      {/* Vibration Transducer Callout */}
      <rect x="85" y="128" width="112" height="22" rx="4" fill="#ffffff" stroke="#7c3aed" strokeWidth="1" />
      <circle cx="95" cy="139" r="3" fill="#7c3aed" />
      <text x="104" y="142" fontSize="9" fontWeight="600" fill="#1e1b4b" fontFamily="sans-serif">
        ISO 10816 Triaxial
      </text>
      <line x1="140" y1="128" x2="150" y2="105" stroke="#7c3aed" strokeWidth="1" strokeDasharray="2 2" />

      {/* Thermal Transducer Callout */}
      <rect x="235" y="8" width="115" height="22" rx="4" fill="#ffffff" stroke="#d97706" strokeWidth="1" />
      <circle cx="245" cy="19" r="3" fill="#d97706" />
      <text x="254" y="22" fontSize="9" fontWeight="600" fill="#1e1b4b" fontFamily="sans-serif">
        Thermal Path (dT/dt)
      </text>
      <line x1="280" y1="30" x2="265" y2="52" stroke="#d97706" strokeWidth="1" strokeDasharray="2 2" />
    </svg>
  );
}

/**
 * LoginPage: Polished, professional industrial sign-in experience for Indian mechanical operations.
 * Features clean lavender light theme, two-column responsive layout, explicit role selector (Manager vs Technician),
 * server-verified role matching, accessible show/hide password, and safe development demo sign-in.
 */
export default function LoginPage() {
  const { login, quickDemoLogin, loading, authError } = useAuth();

  const [selectedRole, setSelectedRole] = useState('manager');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
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

    const res = await login(trimmedIdentifier, password, selectedRole);
    if (!res.success) {
      setLocalError(res.message);
    }
  };

  const handleQuickLogin = async (roleType) => {
    if (loading) return;
    setLocalError(null);

    if (roleType === 'manager') {
      setSelectedRole('manager');
    } else if (roleType === 'technician') {
      setSelectedRole('technician');
    }

    const res = await quickDemoLogin(roleType);
    if (!res.success) {
      setLocalError(res.message);
    }
  };

  const errorMessage = localError || authError;

  return (
    <div className="login-page-root">
      <div className="login-layout-wrapper">
        {/* Left Column: Product Introduction & Mechanical Systems Narrative */}
        <div className="login-intro-column">
          <div className="login-intro-header">
            <div className="login-brand-badge" aria-hidden="true">
              <Icon name="brandMark" size={28} color="#ffffff" />
            </div>
            <div>
              <span className="login-brand-logo-text">Presight</span>
              <span className="login-brand-pill">Mechanical Intelligence</span>
            </div>
          </div>

          <div className="login-intro-copy">
            <h1 className="login-product-title">
              AI-Based Predictive Maintenance and Failure Prevention System
            </h1>
            <p className="login-product-desc">
              Dataset-based mechanical health analysis, early kinematic anomaly detection, and
              closed-loop maintenance coordination for industrial gearboxes and rotating machinery.
            </p>
          </div>

          {/* Industrial Technical Illustration */}
          <div className="login-schematic-card">
            <div className="schematic-header">
              <span className="schematic-title">Parallel-Shaft Gearbox Transmission</span>
              <span className="schematic-tag">Kinematic Telemetry</span>
            </div>
            <IndustrialGearboxSchematic />
          </div>

          {/* Core Architectural Highlights */}
          <div className="login-features-list">
            <div className="feature-item">
              <div className="feature-icon-box">
                <Icon name="activity" size={16} color="var(--primary)" />
              </div>
              <div className="feature-content">
                <span className="feature-title">Multi-Signal Telemetry Profiling</span>
                <span className="feature-desc">
                  Triaxial vibration, thermal dynamics, and load current mapped to ISO 10816 standards.
                </span>
              </div>
            </div>

            <div className="feature-item">
              <div className="feature-icon-box">
                <Icon name="analysis" size={16} color="var(--primary)" />
              </div>
              <div className="feature-content">
                <span className="feature-title">Explainable Anomaly Diagnostics</span>
                <span className="feature-desc">
                  Isolation Forest anomaly scoring and Random Forest fault classification with calibrated SHAP values.
                </span>
              </div>
            </div>

            <div className="feature-item">
              <div className="feature-icon-box">
                <Icon name="wrench" size={16} color="var(--primary)" />
              </div>
              <div className="feature-content">
                <span className="feature-title">Closed-Loop Maintenance Coordination</span>
                <span className="feature-desc">
                  Scoped dispatch workflows, technician inspection reports, and managerial review approvals.
                </span>
              </div>
            </div>
          </div>

          <div className="login-deployment-footer">
            <span className="deployment-dot" aria-hidden="true" />
            <span>Bharat Industrial Dynamics • Scoped Multi-Plant Architecture</span>
          </div>
        </div>

        {/* Right Column: Sign-In Form Surface */}
        <div className="login-form-column">
          <div className="login-card-surface">
            <div className="login-card-header">
              <h2 className="login-card-title">Sign In to Your Workspace</h2>
              <p className="login-card-subtitle">
                Select your operational role and authenticate with your organization credentials.
              </p>
            </div>

            {/* Role Selection Context */}
            <div className="login-role-selection">
              <label className="form-label" id="role-selection-label">
                Operational Role Context:
              </label>
              <div
                className="role-selector-grid"
                role="radiogroup"
                aria-labelledby="role-selection-label"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedRole === 'manager'}
                  className={`role-card ${selectedRole === 'manager' ? 'role-card-active' : ''}`}
                  onClick={() => {
                    setSelectedRole('manager');
                    setLocalError(null);
                  }}
                >
                  <div className="role-card-top">
                    <span className="role-card-icon" aria-hidden="true">
                      <Icon
                        name="factory"
                        size={18}
                        color={selectedRole === 'manager' ? 'var(--primary)' : 'var(--text-secondary)'}
                      />
                    </span>
                    <span className="role-card-name">Manager</span>
                    {selectedRole === 'manager' && (
                      <span className="role-card-check" aria-hidden="true">
                        <Icon name="check" size={14} color="var(--primary)" />
                      </span>
                    )}
                  </div>
                  <p className="role-card-desc">
                    Factory overview, alerts, technician assignments, and approvals.
                  </p>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedRole === 'technician'}
                  className={`role-card ${selectedRole === 'technician' ? 'role-card-active' : ''}`}
                  onClick={() => {
                    setSelectedRole('technician');
                    setLocalError(null);
                  }}
                >
                  <div className="role-card-top">
                    <span className="role-card-icon" aria-hidden="true">
                      <Icon
                        name="wrench"
                        size={18}
                        color={selectedRole === 'technician' ? 'var(--primary)' : 'var(--text-secondary)'}
                      />
                    </span>
                    <span className="role-card-name">Technician</span>
                    {selectedRole === 'technician' && (
                      <span className="role-card-check" aria-hidden="true">
                        <Icon name="check" size={14} color="var(--primary)" />
                      </span>
                    )}
                  </div>
                  <p className="role-card-desc">
                    Assigned machines, maintenance work, and requests.
                  </p>
                </button>
              </div>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div
                className="login-error-alert"
                role="alert"
                aria-live="polite"
                id="login-error-banner"
              >
                <Icon name="alert" size={18} color="var(--status-critical)" />
                <span className="login-error-text">{errorMessage}</span>
              </div>
            )}

            {/* Sign-In Form */}
            <form onSubmit={handleSubmit} className="login-form" noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="user-identifier">
                  Work Email or Username:
                </label>
                <input
                  id="user-identifier"
                  type="text"
                  className="form-input"
                  autoComplete="username"
                  placeholder={
                    selectedRole === 'manager'
                      ? 'e.g. manager@pune.bharatdynamics.demo'
                      : 'e.g. tech@pune.bharatdynamics.demo'
                  }
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={loading}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={errorMessage ? 'login-error-banner' : undefined}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="user-password">
                  Password:
                </label>
                <div className="password-input-wrapper">
                  <input
                    id="user-password"
                    type={showPassword ? 'text' : 'password'}
                    className="form-input password-input-field"
                    autoComplete="current-password"
                    placeholder="Enter your security password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(errorMessage)}
                    aria-describedby={errorMessage ? 'login-error-banner' : undefined}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                  >
                    <Icon
                      name={showPassword ? 'eyeOff' : 'eye'}
                      size={18}
                      color="var(--text-secondary)"
                    />
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                disabled={loading}
                className="login-submit-btn"
                ariaLabel={`Sign In as ${selectedRole === 'manager' ? 'Factory Manager' : 'Field Technician'}`}
              >
                Sign In as {selectedRole === 'manager' ? 'Manager' : 'Technician'}
              </Button>
            </form>

            {/* Development Quick-Login Drawer */}
            {import.meta.env.DEV && (
              <div className="dev-demo-accounts-box">
                <div className="dev-accounts-header">
                  <span className="dev-tag">DEMO DATA</span>
                  <span className="dev-title">Quick Demo Login</span>
                </div>
                <p className="dev-accounts-desc">
                  Select a seeded prototype account to verify role permissions and scoped access to
                  Pune Precision Powertrains Plant #2:
                </p>

                <div className="dev-buttons-grid">
                  <button
                    type="button"
                    className={`dev-role-quick-btn ${selectedRole === 'manager' ? 'dev-btn-active' : ''}`}
                    onClick={() => handleQuickLogin('manager')}
                    disabled={loading}
                    title="Full management of Pune Powertrain Plant #2"
                  >
                    <Icon name="factory" size={14} color="var(--primary)" />
                    <span>Manager (Sunita Rao) [Demo]</span>
                  </button>
                  <button
                    type="button"
                    className={`dev-role-quick-btn ${selectedRole === 'technician' ? 'dev-btn-active' : ''}`}
                    onClick={() => handleQuickLogin('technician')}
                    disabled={loading}
                    title="Assigned to GB-104; maintenance work orders"
                  >
                    <Icon name="wrench" size={14} color="var(--primary)" />
                    <span>Technician (Rajesh Kumar) [Demo]</span>
                  </button>
                  <button
                    type="button"
                    className="dev-role-quick-btn dev-btn-subtle"
                    onClick={() => handleQuickLogin('viewer')}
                    disabled={loading}
                    title="Read-only access to assigned Pune assets"
                  >
                    <Icon name="layer" size={14} color="var(--text-muted)" />
                    <span>Viewer (Amit Desai) [Demo]</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
