import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AssignedMachinesScreen from '../screens/AssignedMachinesScreen.js';
import MachineDetailScreen from '../screens/MachineDetailScreen.js';
import UploadDatasetScreen from '../screens/UploadDatasetScreen.js';
import ActiveAlertsScreen from '../screens/ActiveAlertsScreen.js';
import AlertDetailScreen from '../screens/AlertDetailScreen.js';
import MaintenanceNotesScreen from '../screens/MaintenanceNotesScreen.js';
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

  const factoryName = user?.factory?.name || user?.factoryId?.name || 'Assigned Factory';
  const userRole = user?.role || 'technician';
  const userName = user?.fullName || 'Technician';

  const renderContent = () => {
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
    { key: 'machines', label: 'Machines', iconName: 'cpu' },
    { key: 'upload', label: 'Check-In', iconName: 'upload-cloud' },
    { key: 'alerts', label: 'Warnings', iconName: 'alert-triangle' },
    { key: 'notes', label: 'Field Tasks', iconName: 'clipboard' }
  ];

  return (
    <SafeAreaView style={styles.root}>
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
            <Feather name="map-pin" size={11} color="#64748b" style={{ marginRight: 4 }} />
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
            <Feather name="log-out" size={13} color="#64748b" style={{ marginRight: 4 }} />
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
                setSelectedMachine(null);
                setSelectedAlert(null);
                setActiveTab(tab.key);
              }}
              style={[styles.tabBtn, isActive && styles.tabBtnActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.tabIconBox}>
                <Feather
                  name={tab.iconName}
                  size={20}
                  color={isActive ? '#7c3aed' : '#64748b'}
                />
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
    backgroundColor: '#f6f5fb',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#ede9f6',
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 2,
  },
  userScopeContainer: {
    flex: 1,
    gap: 3,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1e1b4b',
    letterSpacing: -0.3,
  },
  roleTag: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  roleTagText: {
    fontSize: 9,
    color: '#7c3aed',
    fontWeight: '800',
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scopeText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    maxWidth: 160,
  },
  demoTag: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  demoTagText: {
    fontSize: 8,
    color: '#475569',
    fontWeight: '700',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  apiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    gap: 5,
    minHeight: 32,
  },
  apiOnline: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  apiDegraded: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  apiDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOnline: {
    backgroundColor: '#16a34a',
  },
  dotDegraded: {
    backgroundColor: '#d97706',
  },
  apiLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 32,
  },
  signOutText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#ede9f6',
    paddingBottom: Platform.OS === 'ios' ? 14 : 6,
    paddingTop: 6,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 4,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 4,
    gap: 3,
  },
  tabBtnActive: {
    borderTopWidth: 2,
    borderTopColor: '#7c3aed',
  },
  tabIconBox: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 24,
  },
  badgeCount: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#dc2626',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeCountText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  tabLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#7c3aed',
    fontWeight: '700',
  },
});
