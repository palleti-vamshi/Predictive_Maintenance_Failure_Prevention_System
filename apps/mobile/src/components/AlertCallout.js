import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import StatusBadge from './StatusBadge.js';

export default function AlertCallout({
  severity = 'info',
  title,
  description,
  timestamp,
  contributingSignals = [],
  action,
  isSimulated = false
}) {
  const borderColors = {
    critical: '#dc2626',
    warning: '#d97706',
    info: '#7c3aed',
    demo: '#7c3aed'
  };

  return (
    <View style={[
      styles.container,
      {
        borderLeftColor: borderColors[severity] || borderColors.info,
      }
    ]}>
      <View style={styles.header}>
        <StatusBadge status={severity} label={severity.toUpperCase()} isSimulated={isSimulated} />
        {timestamp && <Text style={styles.time}>{timestamp}</Text>}
      </View>

      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.desc}>{description}</Text>}

      {contributingSignals.length > 0 && (
        <View style={styles.signalsContainer}>
          <Text style={styles.signalsHeader}>Contributing Sensor Signals:</Text>
          <View style={styles.signalsList}>
            {contributingSignals.map((item, idx) => (
              <View key={idx} style={styles.signalPill}>
                <Text style={styles.signalName}>{item.signal}</Text>
                <Text style={styles.signalVal}>{item.value}</Text>
                {item.delta && <Text style={styles.signalDelta}>({item.delta})</Text>}
              </View>
            ))}
          </View>
        </View>
      )}

      {action && <View style={styles.actionSlot}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede9f6',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 14,
    gap: 8,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  time: {
    fontSize: 11,
    color: '#64748b',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  desc: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  signalsContainer: {
    marginTop: 4,
    paddingTop: 8,
    borderTopColor: '#f1f5f9',
    borderTopWidth: 1,
    gap: 6,
  },
  signalsHeader: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  signalsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  signalPill: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignItems: 'center',
    gap: 4,
  },
  signalName: {
    fontSize: 10,
    color: '#64748b',
  },
  signalVal: {
    fontSize: 10,
    color: '#1e1b4b',
    fontWeight: '700',
  },
  signalDelta: {
    fontSize: 9,
    color: '#d97706',
    fontWeight: '600',
  },
  actionSlot: {
    marginTop: 6,
  },
});
