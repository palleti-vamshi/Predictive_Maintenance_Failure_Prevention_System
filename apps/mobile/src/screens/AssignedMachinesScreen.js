import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';
import { DEMO_MACHINES, DEMO_USER } from '@predictive-maintenance/shared';
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
      // Fallback to demo equipment
      setMachines(DEMO_MACHINES);
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
        // Token expired or revoked on server
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
        setMachines(DEMO_MACHINES);
        setIsLiveApi(false);
      }
    } catch (err) {
      console.warn('[AssignedMachinesScreen] Live fetch failed, using fallback:', err.message);
      setFetchError(err.message);
      setMachines(DEMO_MACHINES);
      setIsLiveApi(false);
    } finally {
      setIsLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    fetchScopedMachines();
  }, [fetchScopedMachines]);

  const displayName = user?.fullName || DEMO_USER.name;
  const userRole = (user?.role || 'technician').toUpperCase();
  const factoryName = user?.factory?.name || 'Detroit Powertrain Plant #2';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Technician Assignment Header */}
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>{userRole} FIELD SCOPE</Text>
          <View style={[styles.scopeBadge, isLiveApi ? styles.scopeBadgeLive : styles.scopeBadgeDemo]}>
            <Text style={[styles.scopeBadgeText, isLiveApi ? styles.scopeTextLive : styles.scopeTextDemo]}>
              {isLiveApi ? 'BACKEND VERIFIED' : 'DEMO FALLBACK'}
            </Text>
          </View>
        </View>
        <Text style={styles.technicianName}>{displayName}</Text>
        <Text style={styles.subtext}>
          Factory: {factoryName}
        </Text>
        <Text style={styles.subtext}>
          Assigned Equipment: {machines.length} Industrial Gearbox{machines.length === 1 ? '' : 'es'}
        </Text>
      </View>

      {/* Loading Indicator */}
      {isLoading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#38bdf8" />
          <Text style={styles.loadingText}>Loading assigned equipment...</Text>
        </View>
      )}

      {/* Offline / Error notice if applicable */}
      {fetchError && !isLoading && (
        <View style={styles.offlineNotice}>
          <Text style={styles.offlineNoticeText}>
            ℹ️ Offline: Displaying cached/demo gearbox configuration.
          </Text>
        </View>
      )}

      {/* Machine Cards */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Assigned Gearboxes</Text>
        <TouchableOpacity onPress={fetchScopedMachines} accessibilityRole="button">
          <Text style={styles.refreshBtn}>↻ Refresh</Text>
        </TouchableOpacity>
      </View>

      {!isLoading && machines.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No Gearboxes Assigned</Text>
          <Text style={styles.emptyDesc}>
            Your user account is not currently assigned to any machines at {factoryName}.
            Please contact your factory manager to request equipment assignment.
          </Text>
        </View>
      )}

      {machines.map((machine) => (
        <Card
          key={machine.id || machine.dbId}
          title={`${machine.id}: ${machine.name}`}
          subtitle={`${machine.manufacturer} • Model ${machine.model}`}
          badge={
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <View style={{
                backgroundColor: machine.isDecommissioned ? 'rgba(239, 68, 68, 0.2)' : 'rgba(2, 132, 199, 0.2)',
                paddingHorizontal: 5,
                paddingVertical: 1,
                borderRadius: 3
              }}>
                <Text style={{
                  color: machine.isDecommissioned ? '#fca5a5' : '#38bdf8',
                  fontSize: 8,
                  fontWeight: '800'
                }}>
                  {machine.operationalStatus?.toUpperCase() || 'OPERATIONAL'}
                </Text>
              </View>
              <StatusBadge
                status={machine.status}
                label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'}
                isSimulated={!isLiveApi}
              />
            </View>
          }
          action={
            <View style={styles.cardActions}>
              <Button
                title="View Gearbox Profile →"
                variant="primary"
                onPress={() => onSelectMachine(machine)}
                style={styles.actionBtn}
              />
            </View>
          }
        >
          <View style={styles.specsRow}>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>Site Location</Text>
              <Text style={styles.specVal}>{machine.site}</Text>
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

          {machine.stages && machine.stages.length > 0 && (
            <View style={styles.stagesRow}>
              {machine.stages.map((stg, idx) => (
                <View key={stg.stage || idx} style={styles.stageChip}>
                  <Text style={styles.stageChipText}>
                    Stg {stg.stage || idx + 1}: {stg.type} ({stg.ratio})
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      ))}

      <View style={styles.uploadCtaBox}>
        <Text style={styles.uploadCtaTitle}>Ready to upload new sensor run?</Text>
        <Text style={styles.uploadCtaDesc}>
          Attach historical CSV readings for condition analysis and baseline comparison.
        </Text>
        <Button
          title="Go to Dataset Check-In"
          variant="secondary"
          onPress={onNavigateUpload}
          style={{ marginTop: 8 }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    paddingBottom: 32,
  },
  headerBox: {
    backgroundColor: '#131d33',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38bdf8',
    letterSpacing: 0.5,
  },
  scopeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
  },
  scopeBadgeLive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  scopeBadgeDemo: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    borderColor: 'rgba(168, 85, 247, 0.5)',
  },
  scopeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  scopeTextLive: {
    color: '#34d399',
  },
  scopeTextDemo: {
    color: '#d8b4fe',
  },
  technicianName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtext: {
    fontSize: 12,
    color: '#94a3b8',
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  offlineNotice: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
  },
  offlineNoticeText: {
    color: '#fcd34d',
    fontSize: 11,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  refreshBtn: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  emptyDesc: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  specsRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#0f172a',
    borderRadius: 6,
    padding: 10,
  },
  specBox: {
    flex: 1,
  },
  specLabel: {
    fontSize: 10,
    color: '#64748b',
  },
  specVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f8fafc',
    marginTop: 2,
  },
  stagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stageChip: {
    backgroundColor: '#1a2744',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  stageChipText: {
    fontSize: 11,
    color: '#cbd5e1',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
  },
  uploadCtaBox: {
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginTop: 6,
  },
  uploadCtaTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  uploadCtaDesc: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
});
