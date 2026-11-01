import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

export default function MetricCard({ label, value, unit, status = 'info', sublabel, delta, isSimulated = false }) {
  const statusColors = {
    healthy: '#16a34a',
    warning: '#d97706',
    critical: '#dc2626',
    info: '#7c3aed',
    demo: '#7c3aed'
  };

  const valColor = statusColors[status] || '#7c3aed';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        {isSimulated && (
          <View style={styles.simBadge}>
            <Text style={styles.simText}>DEMO</Text>
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
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
    flex: 1,
    minWidth: 140,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  simBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
    borderColor: 'rgba(124, 58, 237, 0.25)',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  simText: {
    fontSize: 9,
    color: '#7c3aed',
    fontWeight: '700',
  },
  valRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 2,
  },
  val: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopColor: '#f1f5f9',
    borderTopWidth: 1,
  },
  sublabel: {
    fontSize: 10,
    color: '#64748b',
  },
  delta: {
    fontSize: 10,
    fontWeight: '700',
  },
  deltaWarn: {
    color: '#d97706',
  },
  deltaGood: {
    color: '#16a34a',
  },
});
