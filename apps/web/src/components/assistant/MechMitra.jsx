import React, { useState, useEffect } from 'react';
import Icon from '../common/Icon.jsx';

/**
 * MechMitra: Compact Animated Mechanical Companion for MechGuard Copilot.
 * 
 * Inspired by precision industrial kinematics and telemetry sensors.
 * Crafted purely with SVG and CSS tokens (zero external images/3D/video).
 * Truthfully reflects real assistant activity, loading states, and factory alerts.
 */
export default function MechMitra({
  isOpen = false,
  isMinimized = false,
  isLoading = false,
  isListening = false,
  recentSuccess = false,
  alertCount = 0,
  onToggle,
  onOpen
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  // Monitor viewport size to handle mobile layout docking/hiding
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Determine current active companion state
  // Hierarchy: Thinking (query active) > Success (response just landed) > Listening (typing/input focused) > Alert (unacknowledged alerts) > Idle
  let currentState = 'idle';
  if (isLoading) {
    currentState = 'thinking';
  } else if (recentSuccess) {
    currentState = 'success';
  } else if (isListening) {
    currentState = 'listening';
  } else if (alertCount > 0) {
    currentState = 'alert';
  }

  // State-specific descriptive labels for accessibility & tooltip
  const stateLabels = {
    thinking: 'Analyzing Telemetry...',
    success: 'Analysis Complete',
    listening: 'Listening to Query...',
    alert: `${alertCount} Active Alert${alertCount === 1 ? '' : 's'}`,
    idle: 'Copilot Ready'
  };

  const handleAction = () => {
    if (typeof onToggle === 'function') {
      onToggle();
    } else if (typeof onOpen === 'function') {
      onOpen();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleAction();
    }
  };

  // On mobile, if Copilot bottom sheet is open, hide companion to avoid touch collision
  if (isMobile && isOpen) {
    return null;
  }

  return (
    <div
      className={`mechmitra-companion-container state-${currentState} ${
        isOpen ? 'copilot-open' : 'copilot-closed'
      } ${isMinimized ? 'copilot-minimized' : ''}`}
    >
      <button
        type="button"
        className="mechmitra-companion-btn"
        onClick={handleAction}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        aria-label="Open MechGuard Copilot"
        title="Open MechGuard Copilot"
        aria-haspopup="dialog"
        aria-expanded={isOpen && !isMinimized}
        tabIndex={0}
      >
        {/* Animated Background Beacon Pulse (Alert & Thinking states) */}
        <span className="mechmitra-pulse-beacon" aria-hidden="true" />

        {/* Polished Mechanical Mascot SVG (48x48 Coordinate System) */}
        <svg
          viewBox="0 0 48 48"
          className="mechmitra-character-svg"
          aria-hidden="true"
        >
          <defs>
            {/* Chassis Radial Gradient */}
            <radialGradient id="mitraChassisGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0b2c28" />
              <stop offset="70%" stopColor="#061c1a" />
              <stop offset="100%" stopColor="#020d0c" />
            </radialGradient>

            {/* Sensor Eye Glow Filter */}
            <filter id="mitraGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Precision 8-Tooth Kinematic Outer Gear */}
          <g className="mechmitra-gear-ring">
            {/* Gear Rim */}
            <circle
              cx="24"
              cy="24"
              r="17"
              className="mechmitra-gear-rim"
            />
            {/* 8 Symmetrical Teeth at 45° Increments */}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <rect
                key={deg}
                x="22.25"
                y="3.5"
                width="3.5"
                height="5.5"
                rx="1"
                className="mechmitra-gear-tooth"
                transform={`rotate(${deg} 24 24)`}
              />
            ))}
          </g>

          {/* Concentric Sensor Housing */}
          <circle
            cx="24"
            cy="24"
            r="13.5"
            fill="url(#mitraChassisGrad)"
            className="mechmitra-chassis-rim"
          />

          {/* Precision Kinematic Orientation Ticks */}
          <line x1="24" y1="11" x2="24" y2="13.5" className="mechmitra-tick" />
          <line x1="24" y1="34.5" x2="24" y2="37" className="mechmitra-tick" />
          <line x1="11" y1="24" x2="13.5" y2="24" className="mechmitra-tick" />
          <line x1="34.5" y1="24" x2="37" y2="24" className="mechmitra-tick" />

          {/* Optical Sensor Aperture Housing */}
          <circle
            cx="24"
            cy="24"
            r="8.5"
            className="mechmitra-sensor-lens"
          />

          {/* Dynamic Iris / Sensor Core */}
          <circle
            cx="24"
            cy="24"
            r="5"
            className="mechmitra-sensor-core"
          />

          {/* Concentric Pupil / Wave Aperture */}
          <circle
            cx="24"
            cy="24"
            r="2.5"
            className="mechmitra-sensor-pupil"
          />

          {/* Specular Glint Reflection */}
          <circle cx="21.5" cy="21.5" r="1.1" fill="#ffffff" opacity="0.9" />

          {/* Success Mode: Crisp Completion Check */}
          {currentState === 'success' && (
            <path
              d="M20.5 24l2.5 2.5 4.5-4.5"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mechmitra-success-check"
            />
          )}
        </svg>

        {/* Status Indicator Pip / Badge */}
        <span className="mechmitra-status-pip" aria-hidden="true">
          {currentState === 'alert' ? (
            <span className="mechmitra-pip-alert-symbol">!</span>
          ) : null}
        </span>
      </button>

      {/* Accessible Hover / Focus Tooltip */}
      <div
        className={`mechmitra-tooltip ${(isHovered || isFocused) ? 'is-visible' : ''}`}
        role="tooltip"
        aria-hidden={!isHovered && !isFocused}
      >
        <div className="mechmitra-tooltip-head">
          <span className="mechmitra-tooltip-brand">MechMitra</span>
          <span className="mechmitra-tooltip-badge">{stateLabels[currentState]}</span>
        </div>
        <div className="mechmitra-tooltip-prompt">
          {isOpen && !isMinimized ? 'Minimize or toggle Copilot' : 'Open MechGuard Copilot'}
        </div>
      </div>
    </div>
  );
}

