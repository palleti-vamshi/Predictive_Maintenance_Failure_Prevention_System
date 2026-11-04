import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';
import { useAuth } from '../context/AuthContext.js';
import { API_BASE } from '../services/apiConfig.js';

export default function AssignedMachinesScreen({ onSelectMachine, onNavigateUpload }) {
  const { user, token, logout } = useAuth();
  const [machines, setMachines] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLiveApi, setIsLiveApi] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchScopedMachines = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);

    if (!token) {
      setMachines([]);
      setIsLiveApi(false);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/machines`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (res.status === 401) {
        await logout();
        return;
      }

      if (!res.ok) {
        throw new Error(`API returned ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (Array.isArray(data.machines)) {
        const mapped = data.machines.map((m) => ({
          id: m.code,
          dbId: m._id,
          name: m.name,
          manufacturer: m.manufacturer,
          model: m.model,
          serialNumber: m.serialNumber,
          operationalStatus: m.operationalStatus || 'operational',
          isDecommissioned: m.isDecommissioned,
          type: m.type || 'gearbox',
          industry: m.industry || 'manufacturing',
          operatingContext: m.operatingContext || '',
          arrangement: m.arrangement || 'Helical-Planetary',
          status: m.status || 'healthy',
          site: m.siteId?.name || 'Assigned Site',
          gearRatio: m.gearRatio || '14.2:1',
          ratedSpeedRpm: m.ratedSpeedRpm || 1780,
          ratedTorqueNm: m.ratedTorqueNm || 480,
          lubrication: m.lubrication,
          lubricantType: m.lubrication?.isoVgGrade || m.lubricantType || 'ISO VG 220',
          stages: m.stages || [],
          monitoredSignals: m.monitoredSignals || [],
          notes: m.notes || [],
          isLive: true
        }));
        setMachines(mapped);
        setIsLiveApi(true);
      } else {
        setMachines([]);
        setIsLiveApi(false);
      }
    } catch (err) {
      console.warn('[AssignedMachinesScreen] Live fetch failed:', err.message);
      setFetchError(err.message);
      setMachines([]);
      setIsLiveApi(false);
    } finally {
      setIsLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    fetchScopedMachines();
  }, [fetchScopedMachines]);

  const displayName = user?.fullName || 'Technician';
  const userRole = (user?.role || 'technician').toUpperCase();
  const factoryName = user?.factory?.name || user?.factoryId?.name || 'Assigned Factory';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Technician Assignment Header */}
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>{userRole} FIELD SCOPE</Text>
          <View style={[styles.apiBadge, isLiveApi ? styles.apiBadgeLive : styles.apiBadgeSim]}>
            <Text style={[styles.apiBadgeText, isLiveApi ? styles.apiTextLive : styles.apiTextSim]}>
              {isLiveApi ? 'MONGODB LIVE' : 'DEMO MODE'}
            </Text>
          </View>
        </View>

        <Text style={styles.headerTitle}>{displayName}</Text>
        <Text style={styles.headerSubtitle}>
          Scope: {factoryName} • {machines.length} Assigned Transmission Asset{machines.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Loading Indicator */}
      {isLoading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#7c3aed" />
          <Text style={styles.loadingText}>Loading assigned equipment...</Text>
        </View>
      )}

      {/* Section Title */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Assigned Gearbox Specimens</Text>
        <TouchableOpacity onPress={fetchScopedMachines} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Feather name="refresh-cw" size={12} color="#7c3aed" />
          <Text style={styles.refreshBtn}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Machine Cards */}
      {machines.length === 0 && !isLoading ? (
        <View style={styles.emptyCard}>
          <Feather name="cpu" size={32} color="#94a3b8" />
          <Text style={styles.emptyTitle}>No Equipment Assigned</Text>
          <Text style={styles.emptyDesc}>
            Your user account is authenticated, but no gearboxes are assigned to your technician scope in this factory.
          </Text>
        </View>
      ) : (
        machines.map((machine) => (
          <Card
            key={machine.id}
            title={`${machine.id} — ${machine.name}`}
            subtitle={`${machine.manufacturer || 'Specimen'} • ${(machine.type || 'gearbox').replace('_', ' ').toUpperCase()} • ${machine.site}`}
            badge={
              <StatusBadge
                status={machine.status}
                label={machine.isDecommissioned ? 'DECOMMISSIONED' : machine.status?.toUpperCase()}
              />
            }
          >
            {machine.operatingContext ? (
              <View style={{ backgroundColor: '#f5f3ff', padding: 8, borderRadius: 6, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#7c3aed' }}>
                <Text style={{ fontSize: 11, color: '#6d28d9', fontWeight: '500' }}>Context: {machine.operatingContext}</Text>
              </View>
            ) : null}
            {/* Gearbox Kinematics & Specs */}
            <View style={styles.specsRow}>
              <View style={styles.specBox}>
                <Text style={styles.specLabel}>Arrangement</Text>
                <Text style={styles.specVal}>{machine.arrangement}</Text>
              </View>
              <View style={styles.specBox}>
                <Text style={styles.specLabel}>Ratio</Text>
                <Text style={styles.specVal}>{machine.gearRatio}</Text>
              </View>
              <View style={styles.specBox}>
                <Text style={styles.specLabel}>Rated Speed</Text>
                <Text style={styles.specVal}>{machine.ratedSpeedRpm} RPM</Text>
              </View>
            </View>

            {/* Stages & Bearings summary */}
            {machine.stages?.length > 0 && (
              <View style={styles.stagesRow}>
                {machine.stages.map((stage, idx) => (
                  <View key={idx} style={styles.stageChip}>
                    <Text style={styles.stageChipText}>
                      Stage {stage.stage}: {stage.type} ({stage.ratio})
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Actions for this machine */}
            <View style={styles.cardActions}>
              <Button
                title="Inspect Kinematics"
                variant="primary"
                onPress={() => onSelectMachine(machine)}
                style={styles.actionBtn}
              />
              <Button
                title="Check-In Run"
                variant="outline"
                onPress={onNavigateUpload}
                style={styles.actionBtn}
              />
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    backgroundColor: '#f6f5fb',
  },
  headerBox: {
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 6,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7c3aed',
    letterSpacing: 0.5,
  },
  apiBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  apiBadgeLive: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  apiBadgeSim: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
  },
  apiBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  apiTextLive: {
    color: '#16a34a',
  },
  apiTextSim: {
    color: '#7c3aed',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e1b4b',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748b',
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
  },
  loadingText: {
    color: '#64748b',
    fontSize: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e1b4b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  refreshBtn: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  emptyDesc: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
  },
  specsRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ede9f6',
    padding: 10,
  },
  specBox: {
    flex: 1,
  },
  specLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '500',
  },
  specVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e1b4b',
    marginTop: 2,
  },
  stagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stageChip: {
    backgroundColor: '#f5f3ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  stageChipText: {
    fontSize: 11,
    color: '#6d28d9',
    fontWeight: '500',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
  },
});
