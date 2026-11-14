import React, { useState, useEffect, useCallback } from 'react';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';
import MobileBottomNav from './MobileBottomNav.jsx';
import AssistantDrawer from '../assistant/AssistantDrawer.jsx';
import MechMitra from '../assistant/MechMitra.jsx';
import SearchModal from '../search/SearchModal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Shell: Master responsive application container.
 * Features dark navy sidebar on desktop and full-bleed main workspace.
 * Integrates In-App AI Assistant Drawer, MechMitra companion, and Scoped Operational Search Modal.
 */
export default function Shell({ children, apiStatus }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [restoreTrigger, setRestoreTrigger] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState('');
  const [openAlertCount, setOpenAlertCount] = useState(0);

  // Synchronized Copilot activity for companion mascot (MechMitra)
  const [assistantActivity, setAssistantActivity] = useState({
    isLoading: false,
    isListening: false,
    isMinimized: false,
    scopedAlertCount: 0,
    recentSuccess: false
  });

  // Query live database alerts on startup to ground MechMitra in real factory condition
  useEffect(() => {
    let isMounted = true;
    async function fetchOpenAlerts() {
      try {
        const res = await fetch(`${API_BASE}/alerts?status=open`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          const active = (data.alerts || []).filter(
            (a) => a.status === 'open' || a.status === 'OPEN'
          );
          setOpenAlertCount(active.length);
        }
      } catch (err) {
        // Safe fallback for unauthenticated / offline states
      }
    }

    fetchOpenAlerts();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleAssistantActivity = useCallback((activity) => {
    setAssistantActivity((prev) => ({
      ...prev,
      ...activity
    }));
  }, []);

  const handleOpenSearch = (initialQuery = '') => {
    setSearchInitialQuery(initialQuery);
    setSearchOpen(true);
  };

  const handleToggleCompanion = () => {
    if (!assistantOpen) {
      setAssistantOpen(true);
    } else if (assistantActivity.isMinimized) {
      // If Copilot is minimized, restore it
      setRestoreTrigger((prev) => prev + 1);
    } else {
      // If Copilot is open in normal view, toggle it closed
      setAssistantOpen(false);
    }
  };

  const effectiveAlertCount = assistantActivity.scopedAlertCount || openAlertCount;

  return (
    <div className="app-shell-root">
      {/* Dark Navy Sidebar on Left */}
      <Sidebar
        mobileNavOpen={mobileNavOpen}
        onCloseMobileNav={() => setMobileNavOpen(false)}
        onOpenAssistant={() => setAssistantOpen(true)}
      />

      {/* Main Container on Right */}
      <div className="app-main-container">
        {/* Slim Top Bar */}
        <Header
          onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
          mobileNavOpen={mobileNavOpen}
          apiStatus={apiStatus}
          onOpenSearch={handleOpenSearch}
          onOpenAssistant={() => setAssistantOpen(true)}
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

      {/* In-App AI Maintenance Assistant Drawer */}
      <AssistantDrawer
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onActivityChange={handleAssistantActivity}
        restoreTrigger={restoreTrigger}
      />

      {/* MechMitra: Compact Animated Mechanical Companion for MechGuard Copilot */}
      <MechMitra
        isOpen={assistantOpen}
        isMinimized={assistantActivity.isMinimized}
        isLoading={assistantActivity.isLoading}
        isListening={assistantActivity.isListening}
        recentSuccess={assistantActivity.recentSuccess}
        alertCount={effectiveAlertCount}
        onToggle={handleToggleCompanion}
        onOpen={() => setAssistantOpen(true)}
      />

      {/* Scoped Operational Search Modal */}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        initialQuery={searchInitialQuery}
      />
    </div>
  );
}
