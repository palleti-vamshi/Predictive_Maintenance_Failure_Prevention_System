import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

export default function Card({ title, subtitle, badge, action, children, style }) {
  return (
    <View style={[styles.card, style]}>
      {(title || subtitle || badge || action) && (
        <View style={styles.cardHeader}>
          <View style={styles.titleGroup}>
            {title && <Text style={styles.cardTitle}>{title}</Text>}
            {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
          </View>
          {badge && <View style={styles.badgeSlot}>{badge}</View>}
        </View>
      )}
      <View style={styles.cardBody}>
        {children}
      </View>
      {action && (
        <View style={styles.cardFooter}>
          {action}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#131d33',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleGroup: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  badgeSlot: {
    alignSelf: 'flex-start',
  },
  cardBody: {
    gap: 8,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 10,
    marginTop: 4,
  },
});

