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
        <ActivityIndicator color={variant === 'primary' ? '#ffffff' : '#7c3aed'} size="small" />
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
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnPrimary: {
    backgroundColor: '#7c3aed',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  btnSecondary: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    borderWidth: 1,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderColor: '#ddd6fe',
    borderWidth: 1,
  },
  btnDanger: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  textBase: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  textPrimary: {
    color: '#ffffff',
  },
  textSecondary: {
    color: '#7c3aed',
  },
  textOutline: {
    color: '#7c3aed',
  },
  textDanger: {
    color: '#dc2626',
  },
  textGhost: {
    color: '#64748b',
  },
});
