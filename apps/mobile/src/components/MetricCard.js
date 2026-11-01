import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

export default function MetricCard({ label, value, unit, status = 'info', sublabel, delta, isSimulated = true }) {
  const statusColors = {
    healthy: '#10b981',
    warning: '#f59e0b',
    critical: '#f43f5e',
    info: '#38bdf8',
    demo: '#c084fc'
  };

  const valColor = statusColors[status] || '#38bdf8';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        {isSimulated && (
          <View style={styles.simBadge}>
            <Text style={styles.simText}>SIM</Text>
          </View>
        )}
      </View>

      <View style={styles.valRow}>
        <Text style={[styles.val, { color: valColor }]}>{value}</Text>
        {unit && <Text style={styles.unit}>{unit}</Text>}
      </View>

      {(sublabel || delta) && (
        <View style={styles.footerRow}>
          {sublabel && <Text style={styles.sublabel}>{sublabel}</Text>}
          {delta && (
            <Text style={[styles.delta, delta.startsWith('+') ? styles.deltaWarn : styles.deltaGood]}>
              {delta}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    gap: 4,
    flex: 1,
    minWidth: 140,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
    flex: 1,
  },
  simBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  simText: {
    color: '#c084fc',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  valRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginVertical: 2,
  },
  val: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  unit: {
    fontSize: 12,
    color: '#64748b',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  sublabel: {
    fontSize: 10,
    color: '#64748b',
    flex: 1,
  },
  delta: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  deltaWarn: {
    color: '#f59e0b',
  },
  deltaGood: {
    color: '#10b981',
  },
});

