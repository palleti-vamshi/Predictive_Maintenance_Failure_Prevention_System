import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

export default function StatusBadge({ status = 'info', label, isSimulated = false, style }) {
  const norm = status?.toLowerCase() || 'info';

  const badgeStyles = {
    healthy: styles.badgeHealthy,
    warning: styles.badgeWarning,
    critical: styles.badgeCritical,
    info: styles.badgeInfo,
    demo: styles.badgeDemo
  };

  const textStyles = {
    healthy: styles.textHealthy,
    warning: styles.textWarning,
    critical: styles.textCritical,
    info: styles.textInfo,
    demo: styles.textDemo
  };

  const dotStyles = {
    healthy: styles.dotHealthy,
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
          <Text style={styles.simPillText}>SIM</Text>
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
    borderRadius: 9999,
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
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  simPill: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    marginLeft: 2,
  },
  simPillText: {
    color: '#d8b4fe',
    fontSize: 8,
    fontWeight: '800',
  },

  // Healthy
  badgeHealthy: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  textHealthy: { color: '#10b981' },
  dotHealthy: { backgroundColor: '#10b981' },

  // Warning
  badgeWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  textWarning: { color: '#f59e0b' },
  dotWarning: { backgroundColor: '#f59e0b' },

  // Critical
  badgeCritical: {
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    borderColor: 'rgba(244, 63, 94, 0.35)',
  },
  textCritical: { color: '#f43f5e' },
  dotCritical: { backgroundColor: '#f43f5e' },

  // Info
  badgeInfo: {
    backgroundColor: 'rgba(14, 165, 233, 0.12)',
    borderColor: 'rgba(14, 165, 233, 0.35)',
  },
  textInfo: { color: '#0ea5e9' },
  dotInfo: { backgroundColor: '#0ea5e9' },

  // Demo
  badgeDemo: {
    backgroundColor: 'rgba(168, 85, 247, 0.14)',
    borderColor: 'rgba(168, 85, 247, 0.4)',
  },
  textDemo: { color: '#c084fc' },
  dotDemo: { backgroundColor: '#c084fc' },
});

