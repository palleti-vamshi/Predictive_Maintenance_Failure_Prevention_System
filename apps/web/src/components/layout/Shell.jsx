import React, { useState } from 'react';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';

/**
 * Shell: Master responsive application container.
 */
export default function Shell({ children, apiStatus }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="app-shell-root">
      {/* Top Universal Demo Mode Banner */}
      <div className="demo-global-banner" role="status">
        <span className="banner-tag" aria-hidden="true">BENCHMARK & DEMO ENVIRONMENT</span>
        <span className="banner-message">
          Phase 9 Industrial Command Center • Telemetry and alerts reflect verified research benchmarks & seeded specimens. Seeded records are tagged [SIMULATED].
        </span>
      </div>

      {/* Main App Header */}
      <Header
        onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
        mobileNavOpen={mobileNavOpen}
        apiStatus={apiStatus}
      />

      {/* App Body with Sidebar & Content */}
      <div className="app-body-container">
        <Sidebar
          mobileNavOpen={mobileNavOpen}
          onCloseMobileNav={() => setMobileNavOpen(false)}
        />

        <main className="app-main-content" id="main-content" tabIndex="-1">
          {children}

          <footer className="shell-footer">
            <div className="footer-left">
              <span>Predictive Maintenance & Failure Prevention System • Phase 9 Industrial Command Center</span>
            </div>
            <div className="footer-right">
              <span>Verified API & Role Scoped • Next: Phase 10 Native Mobile Workflows</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

