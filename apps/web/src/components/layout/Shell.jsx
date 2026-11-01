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
              <span>Presight — AI Predictive Maintenance & Failure Prevention System</span>
            </div>
            <div className="footer-right">
              <span>Multi-Signal Telemetry • Gearbox Kinematic Surveillance</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

