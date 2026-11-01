import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

export default function StatusBadge({ status = 'info', label, isSimulated = false, style }) {
  const norm = status?.toLowerCase() || 'info';

  const badgeStyles = {
    healthy: styles.badgeHealthy,
    operational: styles.badgeOperational,
    warning: styles.badgeWarning,
    critical: styles.badgeCritical,
    info: styles.badgeInfo,
    demo: styles.badgeDemo
  };

  const textStyles = {
    healthy: styles.textHealthy,
    operational: styles.textOperational,
    warning: styles.textWarning,
    critical: styles.textCritical,
    info: styles.textInfo,
    demo: styles.textDemo
  };

  const dotStyles = {
    healthy: styles.dotHealthy,
    operational: styles.dotOperational,
    warning: styles.dotWarning,
    critical: styles.dotCritical,
    info: styles.dotInfo,
    demo: styles.dotDemo
  };

  return (
    <View style={[styles.badgeBase, badgeStyles[norm] || styles.badgeInfo, style]}>
      <View style={[styles.dotBase, dotStyles[norm] || styles.dotInfo]} />
      <Text style={[styles.textBase, textStyles[norm] || styles.textInfo]}>
        {label || norm.toUpperCase()}
      </Text>
      {isSimulated && (
        <View style={styles.simPill}>
          <Text style={styles.simPillText}>DEMO</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeBase: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
    gap: 5,
  },
  dotBase: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  textBase: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  simPill: {
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
    marginLeft: 2,
  },
  simPillText: {
    fontSize: 8,
    color: '#7c3aed',
    fontWeight: '800',
  },
  badgeHealthy: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  dotHealthy: {
    backgroundColor: '#16a34a',
  },
  textHealthy: {
    color: '#15803d',
  },
  badgeOperational: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
  },
  dotOperational: {
    backgroundColor: '#7c3aed',
  },
  textOperational: {
    color: '#6d28d9',
  },
  badgeWarning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  dotWarning: {
    backgroundColor: '#d97706',
  },
  textWarning: {
    color: '#b45309',
  },
  badgeCritical: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  dotCritical: {
    backgroundColor: '#dc2626',
  },
  textCritical: {
    color: '#b91c1c',
  },
  badgeInfo: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  dotInfo: {
    backgroundColor: '#64748b',
  },
  textInfo: {
    color: '#334155',
  },
  badgeDemo: {
    backgroundColor: '#fdf4ff',
    borderColor: '#f5d0fe',
  },
  dotDemo: {
    backgroundColor: '#c026d3',
  },
  textDemo: {
    color: '#a21caf',
  },
});
