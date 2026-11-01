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
        <span className="banner-tag" aria-hidden="true">DEMO ENVIRONMENT</span>
        <span className="banner-message">
          Phase 2 Product Shell • All machines, alerts, and sensor baselines are simulated specimens. No physical machinery is connected.
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
              <span>Predictive Maintenance & Failure Prevention System • Phase 2 Shell</span>
            </div>
            <div className="footer-right">
              <span>Next: Phase 3 (Authentication & Scoped Access Control)</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

