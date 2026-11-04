import React, { useState } from 'react';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';
import MobileBottomNav from './MobileBottomNav.jsx';

/**
 * Shell: Master responsive application container.
 * Features dark navy sidebar on desktop and full-bleed main workspace.
 */
export default function Shell({ children, apiStatus }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="app-shell-root">
      {/* Dark Navy Sidebar on Left */}
      <Sidebar
        mobileNavOpen={mobileNavOpen}
        onCloseMobileNav={() => setMobileNavOpen(false)}
      />

      {/* Main Container on Right */}
      <div className="app-main-container">
        {/* Slim Top Bar */}
        <Header
          onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
          mobileNavOpen={mobileNavOpen}
          apiStatus={apiStatus}
        />

        {/* Scrollable Main Content */}
        <main className="app-main-content" id="main-content" tabIndex="-1">
          {children}

          <footer className="shell-footer">
            <div className="footer-left">
              <span>MechGuard AI — Predictive Maintenance & Failure Prevention System</span>
            </div>
            <div className="footer-right">
              <span>Multi-Signal Telemetry • Gearbox Kinematic Surveillance</span>
            </div>
          </footer>
        </main>
      </div>

      {/* Touch-Optimized Mobile Bottom Navigation */}
      <MobileBottomNav />
    </div>
  );
}
