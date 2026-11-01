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
  isSimulated = true
}) {
  const borderColors = {
    critical: 'rgba(244, 63, 94, 0.4)',
    warning: 'rgba(245, 158, 11, 0.4)',
    info: 'rgba(14, 165, 233, 0.4)',
    demo: 'rgba(168, 85, 247, 0.4)'
  };

  const bgColors = {
    critical: 'rgba(244, 63, 94, 0.08)',
    warning: 'rgba(245, 158, 11, 0.08)',
    info: 'rgba(14, 165, 233, 0.08)',
    demo: 'rgba(168, 85, 247, 0.08)'
  };

  return (
    <View style={[
      styles.container,
      {
        borderColor: borderColors[severity] || borderColors.info,
        backgroundColor: bgColors[severity] || bgColors.info
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
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  time: {
    fontSize: 10,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  desc: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
  },
  signalsContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 6,
    padding: 8,
    gap: 4,
    marginTop: 2,
  },
  signalsHeader: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
  },
  signalsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  signalPill: {
    backgroundColor: '#1a2744',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  signalName: {
    fontSize: 10,
    color: '#94a3b8',
  },
  signalVal: {
    fontSize: 10,
    color: '#f8fafc',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  signalDelta: {
    fontSize: 9,
    color: '#f59e0b',
    fontWeight: '700',
  },
  actionSlot: {
    marginTop: 4,
  },
});

