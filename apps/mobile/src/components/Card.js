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
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
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
    color: '#1e1b4b',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  badgeSlot: {
    alignSelf: 'flex-start',
  },
  cardBody: {
    gap: 8,
  },
  cardFooter: {
    borderTopColor: '#f1f5f9',
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 2,
  },
});
