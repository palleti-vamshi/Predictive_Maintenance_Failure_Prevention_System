import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  SafeAreaView
} from 'react-native';
import Button from '../components/Button.js';
import { useAuth } from '../context/AuthContext.js';

export default function LoginScreen() {
  const { login, isLoading, authError, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      return;
    }
    await login(email.trim(), password);
  };

  const handleQuickFillAndLogin = async (fillEmail, fillPassword) => {
    setEmail(fillEmail);
    setPassword(fillPassword);
    clearError();
    await login(fillEmail, fillPassword);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Universal Demo Banner */}
          <View style={styles.demoBanner}>
            <Text style={styles.demoBannerText}>
              DEMO ENVIRONMENT • Simulated Gearbox Telemetry • No Real Hardware
            </Text>
          </View>

          {/* Header & Branding */}
          <View style={styles.headerBox}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoBadgeText}>PM-FS</Text>
            </View>
            <Text style={styles.appTitle}>Predictive Maintenance</Text>
            <Text style={styles.appSubtitle}>Industrial Gearbox Condition Monitoring</Text>
            <View style={styles.terminalBadge}>
              <Text style={styles.terminalBadgeText}>TECHNICIAN FIELD TERMINAL</Text>
            </View>
          </View>

          {/* Login Form Card */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Terminal Authentication</Text>
            <Text style={styles.formHelp}>
              Enter credentials authorized for your assigned industrial plant.
            </Text>

            {authError && (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Text style={styles.errorIcon}>⚠️</Text>
                <View style={styles.errorTextContainer}>
                  <Text style={styles.errorTitle}>Authentication Error</Text>
                  <Text style={styles.errorMessage}>{authError}</Text>
                </View>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Factory Email Address</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (authError) clearError();
                }}
                placeholder="technician@factory.com"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                accessibilityLabel="Factory Email Address"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Security Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (authError) clearError();
                }}
                placeholder="••••••••••••"
                placeholderTextColor="#64748b"
                secureTextEntry
                autoCapitalize="none"
                accessibilityLabel="Security Password"
              />
            </View>

            <Button
              title="Sign In to Terminal"
              variant="primary"
              loading={isLoading}
              disabled={isLoading || !email.trim() || !password}
              onPress={handleSignIn}
              style={styles.signInButton}
            />

            <View style={styles.securityNote}>
              <Text style={styles.securityNoteText}>
                🔒 Scoped to assigned factory & equipment. Access verified server-side.
              </Text>
            </View>
          </View>

          {/* Development Quick-Login Accounts Card (Rendered strictly in development mode) */}
          {__DEV__ && (
            <View style={styles.devCard}>
              <View style={styles.devHeaderRow}>
                <Text style={styles.devTag}>DEV / DEMO</Text>
                <Text style={styles.devTitle}>Pre-Seeded Factory Accounts</Text>
              </View>
              <Text style={styles.devDescription}>
                Tap any role to immediately test scoped authentication against Detroit Plant #2:
              </Text>

              <View style={styles.quickButtons}>
                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => handleQuickFillAndLogin('tech@detroit.factory', 'Tech123!')}
                  disabled={isLoading}
                  accessibilityRole="button"
                >
                  <View style={styles.quickRoleBadgeTech}>
                    <Text style={styles.quickRoleText}>TECHNICIAN</Text>
                  </View>
                  <View style={styles.quickInfo}>
                    <Text style={styles.quickName}>Alex Mercer</Text>
                    <Text style={styles.quickScope}>Detroit #2 • Assigned to GB-104</Text>
                  </View>
                  <Text style={styles.quickArrow}>→</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => handleQuickFillAndLogin('manager@detroit.factory', 'Manager123!')}
                  disabled={isLoading}
                  accessibilityRole="button"
                >
                  <View style={styles.quickRoleBadgeManager}>
                    <Text style={styles.quickRoleText}>MANAGER</Text>
                  </View>
                  <View style={styles.quickInfo}>
                    <Text style={styles.quickName}>Sarah Vance</Text>
                    <Text style={styles.quickScope}>Detroit #2 • Full Plant Scope</Text>
                  </View>
                  <Text style={styles.quickArrow}>→</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => handleQuickFillAndLogin('viewer@detroit.factory', 'Viewer123!')}
                  disabled={isLoading}
                  accessibilityRole="button"
                >
                  <View style={styles.quickRoleBadgeViewer}>
                    <Text style={styles.quickRoleText}>VIEWER</Text>
                  </View>
                  <View style={styles.quickInfo}>
                    <Text style={styles.quickName}>David Sterling</Text>
                    <Text style={styles.quickScope}>Detroit #2 • Read-Only Scope</Text>
                  </View>
                  <Text style={styles.quickArrow}>→</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  demoBanner: {
    backgroundColor: '#1e1338',
    borderColor: 'rgba(168, 85, 247, 0.4)',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  demoBannerText: {
    color: '#d8b4fe',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  headerBox: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  logoBadge: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 4,
  },
  logoBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  terminalBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    marginTop: 4,
  },
  terminalBadgeText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  formCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 18,
    gap: 14,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  formHelp: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: -8,
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#ef4444',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  errorIcon: {
    fontSize: 16,
  },
  errorTextContainer: {
    flex: 1,
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fca5a5',
  },
  errorMessage: {
    fontSize: 11,
    color: '#f8fafc',
    marginTop: 2,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  input: {
    backgroundColor: '#070b14',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#f8fafc',
    minHeight: 44,
  },
  signInButton: {
    marginTop: 4,
  },
  securityNote: {
    alignItems: 'center',
    paddingTop: 4,
  },
  securityNoteText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
  },
  devCard: {
    backgroundColor: '#131d33',
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  devHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  devTag: {
    backgroundColor: '#0284c7',
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  devTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  devDescription: {
    fontSize: 11,
    color: '#94a3b8',
    lineHeight: 16,
  },
  quickButtons: {
    gap: 8,
    marginTop: 4,
  },
  quickBtn: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
  },
  quickRoleBadgeTech: {
    backgroundColor: 'rgba(2, 132, 199, 0.2)',
    borderColor: '#0284c7',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  quickRoleBadgeManager: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    borderColor: '#a855f7',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  quickRoleBadgeViewer: {
    backgroundColor: 'rgba(100, 116, 139, 0.2)',
    borderColor: '#64748b',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  quickRoleText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#f8fafc',
  },
  quickInfo: {
    flex: 1,
  },
  quickName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  quickScope: {
    fontSize: 11,
    color: '#94a3b8',
  },
  quickArrow: {
    fontSize: 16,
    color: '#38bdf8',
    fontWeight: '700',
  },
});

