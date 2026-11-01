import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';
import { DEMO_ALERTS } from '@predictive-maintenance/shared';

export default function ActiveAlertsScreen({ onSelectAlert }) {
  const [alerts, setAlerts] = useState(DEMO_ALERTS);
  const [filter, setFilter] = useState('all');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>ACTIVE WARNINGS FEED</Text>
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
        </View>
        <Text style={styles.title}>Condition Alerts</Text>
        <Text style={styles.subtitle}>
          Explainable warnings triggered by baseline deviations across assigned equipment.
        </Text>
      </View>

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
            Warning (1)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'critical' && styles.filterChipActive]}
          onPress={() => setFilter('critical')}
        >
          <Text style={[styles.filterText, filter === 'critical' && styles.filterTextActive]}>
            Critical (0)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Alerts List */}
      {alerts.map((alert) => (
        <Card
          key={alert.id}
          title={`${alert.machineId}: ${alert.title}`}
          subtitle={`Method: ${alert.methodLabel}`}
          badge={
            <StatusBadge
              status={alert.severity}
              label={alert.severity.toUpperCase()}
              isSimulated={true}
            />
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

          <View style={styles.signalsBox}>
            <Text style={styles.signalsTitle}>Supporting Signals:</Text>
            {alert.contributingSignals.map((sig, idx) => (
              <View key={idx} style={styles.sigRow}>
                <Text style={styles.sigName}>{sig.signal}:</Text>
                <Text style={styles.sigVal}>{sig.value} (delta: {sig.delta})</Text>
              </View>
            ))}
          </View>

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>
              Logged: {new Date(alert.timestamp).toLocaleTimeString()}
            </Text>
            <Text style={styles.statusText}>
              Status: {alert.status.toUpperCase()} [DEMO]
            </Text>
          </View>
        </Card>
      ))}
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
});

