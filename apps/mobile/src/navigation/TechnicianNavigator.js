import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import AssignedMachinesScreen from '../screens/AssignedMachinesScreen.js';
import MachineDetailScreen from '../screens/MachineDetailScreen.js';
import UploadDatasetScreen from '../screens/UploadDatasetScreen.js';
import ActiveAlertsScreen from '../screens/ActiveAlertsScreen.js';
import AlertDetailScreen from '../screens/AlertDetailScreen.js';
import MaintenanceNotesScreen from '../screens/MaintenanceNotesScreen.js';
import { DEMO_FACTORY, DEMO_ALERTS } from '@predictive-maintenance/shared';
import { useAuth } from '../context/AuthContext.js';

export default function TechnicianNavigator({ apiStatus, onRefreshApi }) {
  const { user, logout } = useAuth();

  // Current active tab: 'machines' | 'upload' | 'alerts' | 'notes'
  const [activeTab, setActiveTab] = useState('machines');

  // Drilldown states
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [selectedAlert, setSelectedAlert] = useState(null);

  const handleSelectMachine = (machine) => {
    setSelectedMachine(machine);
  };

  const handleSelectAlert = (alert) => {
    setSelectedAlert(alert);
  };

  const handleBackToMachines = () => {
    setSelectedMachine(null);
  };

  const handleBackToAlerts = () => {
    setSelectedAlert(null);
  };

  const factoryName = user?.factory?.name || DEMO_FACTORY.name;
  const userRole = user?.role || 'technician';
  const userName = user?.fullName || 'Technician';

  const renderContent = () => {
    // If drilled into machine detail
    if (activeTab === 'machines' && selectedMachine) {
      return (
        <MachineDetailScreen
          machine={selectedMachine}
          onBack={handleBackToMachines}
          onNavigateAlerts={() => {
            setSelectedMachine(null);
            setActiveTab('alerts');
          }}
          onNavigateUpload={() => {
            setSelectedMachine(null);
            setActiveTab('upload');
          }}
        />
      );
    }

    // If drilled into alert detail
    if (activeTab === 'alerts' && selectedAlert) {
      return (
        <AlertDetailScreen
          alert={selectedAlert}
          onBack={handleBackToAlerts}
        />
      );
    }

    switch (activeTab) {
      case 'machines':
        return (
          <AssignedMachinesScreen
            onSelectMachine={handleSelectMachine}
            onNavigateUpload={() => setActiveTab('upload')}
          />
        );
      case 'upload':
        return <UploadDatasetScreen />;
      case 'alerts':
        return <ActiveAlertsScreen onSelectAlert={handleSelectAlert} />;
      case 'notes':
        return <MaintenanceNotesScreen />;
      default:
        return <AssignedMachinesScreen onSelectMachine={handleSelectMachine} />;
    }
  };

  const tabs = [
    { key: 'machines', label: 'Machines', icon: '⚙️' },
    { key: 'upload', label: 'Check-In', icon: '📁' },
    { key: 'alerts', label: 'Warnings', icon: '🚨', badge: DEMO_ALERTS.length },
    { key: 'notes', label: 'Field Notes', icon: '📝' }
  ];

  return (
    <SafeAreaView style={styles.root}>
      {/* Universal Demo Banner */}
      <View style={styles.demoBanner}>
        <Text style={styles.demoBannerText}>
          DEMO SHELL • Simulated Gearbox Telemetry • No Real Hardware
        </Text>
      </View>

      {/* Top Mobile Bar with User Profile & Scope */}
      <View style={styles.topBar}>
        <View style={styles.userScopeContainer}>
          <View style={styles.brandRow}>
            <Text style={styles.brandTitle} numberOfLines={1}>{userName}</Text>
            <View style={styles.roleTag}>
              <Text style={styles.roleTagText}>{userRole.toUpperCase()}</Text>
            </View>
          </View>
          <View style={styles.scopeRow}>
            <Text style={styles.scopeText} numberOfLines={1}>
              {factoryName}
            </Text>
            <View style={styles.demoTag}>
              <Text style={styles.demoTagText}>SCOPED</Text>
            </View>
          </View>
        </View>

        {/* Top Actions: API Pill + Logout */}
        <View style={styles.topActions}>
          <TouchableOpacity
            onPress={onRefreshApi}
            style={[styles.apiPill, apiStatus?.hasActiveConnection ? styles.apiOnline : styles.apiDegraded]}
            accessibilityRole="button"
            accessibilityLabel="API Connection Status"
          >
            <View style={[styles.apiDot, apiStatus?.hasActiveConnection ? styles.dotOnline : styles.dotDegraded]} />
            <Text style={styles.apiLabel}>
              {apiStatus?.hasActiveConnection ? 'API' : 'Offline'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={logout}
            style={styles.signOutBtn}
            accessibilityRole="button"
            accessibilityLabel="Sign Out of Terminal"
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Screen Body */}
      <View style={styles.body}>
        {renderContent()}
      </View>

      {/* Bottom Tab Navigation Bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => {
                // Clear drilldowns on explicit tab switch
                setSelectedMachine(null);
                setSelectedAlert(null);
                setActiveTab(tab.key);
              }}
              style={[styles.tabBtn, isActive && styles.tabBtnActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.tabIconBox}>
                <Text style={styles.tabIcon}>{tab.icon}</Text>
                {tab.badge && tab.badge > 0 && (
                  <View style={styles.badgeCount}>
                    <Text style={styles.badgeCountText}>{tab.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  demoBanner: {
    backgroundColor: '#1e1338',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(168, 85, 247, 0.4)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  demoBannerText: {
    color: '#d8b4fe',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  topBar: {
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userScopeContainer: {
    flex: 1,
    marginRight: 8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.2,
    maxWidth: 160,
  },
  roleTag: {
    backgroundColor: 'rgba(2, 132, 199, 0.25)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  roleTagText: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  scopeText: {
    fontSize: 11,
    color: '#94a3b8',
    maxWidth: 160,
  },
  demoTag: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  demoTagText: {
    color: '#c084fc',
    fontSize: 8,
    fontWeight: '800',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  apiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
  },
  apiOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  apiDegraded: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  apiDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOnline: {
    backgroundColor: '#10b981',
  },
  dotDegraded: {
    backgroundColor: '#f59e0b',
  },
  apiLabel: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#cbd5e1',
  },
  signOutBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  signOutText: {
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  tabBar: {
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    flexDirection: 'row',
    minHeight: 56,
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
    paddingTop: 4,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    minHeight: 48,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
    borderTopWidth: 2,
    borderTopColor: '#38bdf8',
  },
  tabIconBox: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 18,
  },
  badgeCount: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    minWidth: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeCountText: {
    color: '#070b14',
    fontSize: 9,
    fontWeight: '800',
  },
  tabLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 2,
  },
  tabLabelActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
});
