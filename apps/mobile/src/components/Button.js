import React from 'react';
import { StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';

export default function Button({
  title,
  onPress,
  variant = 'secondary',
  disabled = false,
  loading = false,
  style,
  textStyle
}) {
  const btnVariants = {
    primary: styles.btnPrimary,
    secondary: styles.btnSecondary,
    outline: styles.btnOutline,
    danger: styles.btnDanger,
    ghost: styles.btnGhost
  };

  const textVariants = {
    primary: styles.textPrimary,
    secondary: styles.textSecondary,
    outline: styles.textOutline,
    danger: styles.textDanger,
    ghost: styles.textGhost
  };

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.btnBase,
        btnVariants[variant] || styles.btnSecondary,
        disabled && styles.btnDisabled,
        style
      ]}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" size="small" />
      ) : (
        <Text style={[styles.textBase, textVariants[variant] || styles.textSecondary, textStyle]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btnBase: {
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  textBase: {
    fontSize: 14,
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: '#0284c7',
    borderColor: '#0369a1',
  },
  textPrimary: {
    color: '#ffffff',
  },
  btnSecondary: {
    backgroundColor: '#1a2744',
    borderColor: '#334155',
  },
  textSecondary: {
    color: '#f8fafc',
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  textOutline: {
    color: '#38bdf8',
  },
  btnDanger: {
    backgroundColor: '#be123c',
    borderColor: '#9f1239',
  },
  textDanger: {
    color: '#ffffff',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  textGhost: {
    color: '#94a3b8',
  },
});

