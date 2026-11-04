import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';
import { useAuth } from '../context/AuthContext.js';
import { API_BASE } from '../services/apiConfig.js';

export default function ActiveAlertsScreen({ onSelectAlert }) {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');

  const fetchAlerts = useCallback(async () => {
    try {
      setError(null);
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/alerts`, { headers });
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      } else {
        setError(`Server returned status ${res.status}`);
      }
    } catch (err) {
      setError(err.message || 'Unable to connect to alert service.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAlerts();
    setRefreshing(false);
  };

  const filteredAlerts = alerts.filter((alert) => {
    if (filter === 'all') return true;
    return (alert.severity || '').toLowerCase() === filter.toLowerCase();
  });

  const criticalCount = alerts.filter((a) => (a.severity || '').toLowerCase() === 'critical').length;
  const warningCount = alerts.filter((a) => (a.severity || '').toLowerCase() === 'warning').length;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38bdf8" />
      }
    >
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>ACTIVE WARNINGS FEED</Text>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>OPERATIONAL</Text>
          </View>
        </View>
        <Text style={styles.title}>Condition Alerts</Text>
        <Text style={styles.subtitle}>
          Explainable warnings triggered by baseline deviations across assigned equipment.
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: 32, alignItems: 'center' }}>
          <ActivityIndicator size="small" color="#7c3aed" />
          <Text style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>Loading assigned machine alerts...</Text>
        </View>
      ) : error ? (
        <View style={styles.emptyCard}>
          <Text style={[styles.emptyTitle, { color: '#ef4444' }]}>Unable to Load Alerts</Text>
          <Text style={styles.emptySub}>{error}</Text>
          <TouchableOpacity onPress={fetchAlerts} style={{ marginTop: 12, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#7c3aed', borderRadius: 6 }}>
            <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 12 }}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Filter Tabs */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
              onPress={() => setFilter('all')}
            >
              <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
                All ({alerts.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, filter === 'warning' && styles.filterChipActive]}
              onPress={() => setFilter('warning')}
            >
              <Text style={[styles.filterText, filter === 'warning' && styles.filterTextActive]}>
                Warning ({warningCount})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, filter === 'critical' && styles.filterChipActive]}
              onPress={() => setFilter('critical')}
            >
              <Text style={[styles.filterText, filter === 'critical' && styles.filterTextActive]}>
                Critical ({criticalCount})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Alerts List */}
          {filteredAlerts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Alerts Found</Text>
              <Text style={styles.emptySub}>No active condition alerts matching &quot;{filter.toUpperCase()}&quot;.</Text>
            </View>
          ) : (
        filteredAlerts.map((alert) => {
          const alertId = alert._id || alert.id;
          const machineCode = alert.machineId?.code || alert.machineCode || alert.machineId || 'Machine';
          const contributingSignals = alert.contributingSignals || alert.contributing_signals || [];
          const peakScore = alert.peakAnomalyScore ?? alert.peak_anomaly_score;
          const threshold = alert.calibratedThreshold ?? alert.calibrated_threshold;

          return (
            <Card
              key={alertId}
              title={`${machineCode}: ${alert.title}`}
              subtitle={`Method: ${alert.modelName || alert.methodLabel || 'Anomaly Detector'}`}
              badge={
                <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                  {alert.triggeringPath && (
                    <View
                      style={[
                        styles.pathChip,
                        alert.triggeringPath === 'thermal_path'
                          ? styles.pathChipThermal
                          : alert.triggeringPath === 'fused_multisignal'
                          ? styles.pathChipFused
                          : styles.pathChipVib
                      ]}
                    >
                      <Text
                        style={[
                          styles.pathChipText,
                          alert.triggeringPath === 'thermal_path'
                            ? styles.pathChipTextThermal
                            : alert.triggeringPath === 'fused_multisignal'
                            ? styles.pathChipTextFused
                            : styles.pathChipTextVib
                        ]}
                      >
                        {alert.triggeringPath === 'thermal_path'
                          ? 'THERMAL'
                          : alert.triggeringPath === 'fused_multisignal'
                          ? 'FUSED'
                          : 'VIB'}
                      </Text>
                    </View>
                  )}
                  {alert.operatingRegime?.regimeId && (
                    <View style={styles.regimeChip}>
                      <Text style={styles.regimeChipText}>{alert.operatingRegime.regimeId}</Text>
                    </View>
                  )}
                  <StatusBadge
                    status={alert.severity}
                    label={alert.severity.toUpperCase()}
                    isSimulated={!isLive}
                  />
                </View>
              }
              action={
                <Button
                  title="Inspect Supporting Signals & Notes →"
                  variant="primary"
                  onPress={() => onSelectAlert(alert)}
                />
              }
            >
              <Text style={styles.alertDesc}>{alert.description}</Text>

              {contributingSignals.length > 0 && (
                <View style={styles.signalsBox}>
                  <Text style={styles.signalsTitle}>Supporting Signals:</Text>
                  {contributingSignals.map((sig, idx) => (
                    <View key={idx} style={styles.sigRow}>
                      <Text style={styles.sigName}>{sig.signal}:</Text>
                      <Text style={styles.sigVal}>
                        {sig.peak_value || sig.value} {sig.unit || 'g'} (delta: {sig.delta_pct || sig.delta})
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {peakScore !== undefined && threshold !== undefined && (
                <View style={styles.thresholdRow}>
                  <Text style={styles.thresholdLabel}>Anomaly Score / Threshold:</Text>
                  <Text style={styles.thresholdVal}>
                    {Number(peakScore).toFixed(3)} / {Number(threshold).toFixed(3)}
                  </Text>
                </View>
              )}

              <View style={styles.timeRow}>
                <Text style={styles.timeText}>
                  Logged: {new Date(alert.createdAt || alert.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={styles.statusText}>
                  Status: {alert.status.toUpperCase()}
                </Text>
              </View>
            </Card>
          );
        })
      )}
      </>
      )}
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
  liveBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
  },
  liveBadgeText: {
    color: '#34d399',
    fontSize: 9,
    fontWeight: '800',
  },
  demoBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  demoBadgeText: {
    color: '#d8b4fe',
    fontSize: 9,
    fontWeight: '800',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipActive: {
    borderColor: '#0284c7',
    backgroundColor: '#1a2744',
  },
  filterText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  filterTextActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  alertDesc: {
    fontSize: 12,
    color: '#cbd5e1',
    lineHeight: 18,
  },
  signalsBox: {
    backgroundColor: '#0f172a',
    borderRadius: 6,
    padding: 10,
    gap: 4,
  },
  signalsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  sigRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sigName: {
    fontSize: 11,
    color: '#94a3b8',
  },
  sigVal: {
    fontSize: 11,
    color: '#f59e0b',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  thresholdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  thresholdLabel: {
    fontSize: 11,
    color: '#94a3b8',
  },
  thresholdVal: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#38bdf8',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    fontSize: 10,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  statusText: {
    fontSize: 10,
    color: '#c084fc',
    fontWeight: '700',
  },
  emptyCard: {
    padding: 24,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  emptySub: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  pathChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pathChipVib: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  pathChipThermal: {
    backgroundColor: 'rgba(251, 146, 60, 0.15)',
    borderWidth: 1,
    borderColor: '#fb923c',
  },
  pathChipFused: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: '#a855f7',
  },
  pathChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  pathChipTextVib: {
    color: '#38bdf8',
  },
  pathChipTextThermal: {
    color: '#fb923c',
  },
  pathChipTextFused: {
    color: '#d8b4fe',
  },
  regimeChip: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  regimeChipText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
});
