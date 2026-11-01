import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Button from '../components/Button.js';
import { useAuth } from '../context/AuthContext.js';
import { USER_ROLES } from '@predictive-maintenance/shared';

export default function LoginScreen() {
  const { login, quickDemoLogin, isLoading, authError, clearError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    await login(email.trim(), password);
  };

  const handleQuickDemo = async (role) => {
    await quickDemoLogin(role);
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header Branding */}
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Feather name="activity" size={24} color="#ffffff" />
            </View>
            <Text style={styles.appTitle}>Presight</Text>
            <Text style={styles.appSubtitle}>
              AI-Based Predictive Maintenance System
            </Text>
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
                <Feather name="alert-circle" size={16} color="#dc2626" />
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
                placeholder="tech@pune.bharatdynamics.demo"
                placeholderTextColor="#94a3b8"
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
                placeholderTextColor="#94a3b8"
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
              <Feather name="shield" size={12} color="#64748b" style={{ marginRight: 4 }} />
              <Text style={styles.securityNoteText}>
                Scoped to assigned factory & equipment. Access verified server-side.
              </Text>
            </View>
          </View>

          {/* Development Quick-Login Accounts Card */}
          {__DEV__ && (
            <View style={styles.devCard}>
              <View style={styles.devHeaderRow}>
                <Text style={styles.devTag}>DEMO ACCOUNTS</Text>
                <Text style={styles.devTitle}>Pre-Seeded Factory Accounts</Text>
              </View>
              <Text style={styles.devDescription}>
                Tap any demo account to immediately test scoped authentication against Pune Precision Powertrains Plant #2 [Demo account]:
              </Text>

              <View style={styles.quickGrid}>
                {/* Technician Quick Button */}
                <TouchableOpacity
                  style={[styles.quickBtn, styles.quickBtnTech]}
                  onPress={() => handleQuickDemo(USER_ROLES.TECHNICIAN)}
                  disabled={isLoading}
                  accessibilityRole="button"
                >
                  <View style={styles.quickBtnHeader}>
                    <Text style={styles.quickRoleText}>Rajesh Kumar (Technician)</Text>
                    <View style={styles.pillTech}>
                      <Text style={styles.pillTextTech}>DEMO ACCOUNT</Text>
                    </View>
                  </View>
                  <Text style={styles.quickEmailText}>tech@pune.bharatdynamics.demo</Text>
                  <Text style={styles.quickScopeText}>Assigned: GB-104 (Dynamic Workload: 3)</Text>
                </TouchableOpacity>

                {/* Manager Quick Button */}
                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => handleQuickDemo(USER_ROLES.FACTORY_MANAGER)}
                  disabled={isLoading}
                  accessibilityRole="button"
                >
                  <View style={styles.quickBtnHeader}>
                    <Text style={styles.quickRoleText}>Sunita Rao (Manager)</Text>
                    <View style={styles.pillManager}>
                      <Text style={styles.pillTextManager}>FULL ACCESS</Text>
                    </View>
                  </View>
                  <Text style={styles.quickEmailText}>manager@pune.bharatdynamics.demo</Text>
                  <Text style={styles.quickScopeText}>Pune Plant Fleet: GB-104, GB-201, PUMP-301, MTR-102</Text>
                </TouchableOpacity>

                {/* Viewer Quick Button */}
                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => handleQuickDemo(USER_ROLES.VIEWER)}
                  disabled={isLoading}
                  accessibilityRole="button"
                >
                  <View style={styles.quickBtnHeader}>
                    <Text style={styles.quickRoleText}>Amit Desai (Viewer)</Text>
                    <View style={styles.pillViewer}>
                      <Text style={styles.pillTextViewer}>READ ONLY</Text>
                    </View>
                  </View>
                  <Text style={styles.quickEmailText}>viewer@pune.bharatdynamics.demo</Text>
                  <Text style={styles.quickScopeText}>Read-only assigned telemetry, write blocked</Text>
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
  root: {
    flex: 1,
    backgroundColor: '#f6f5fb',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 28,
    gap: 16,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  logoBadge: {
    backgroundColor: '#7c3aed',
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1e1b4b',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
  },
  terminalBadge: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    marginTop: 4,
  },
  terminalBadgeText: {
    color: '#7c3aed',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  formCard: {
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    gap: 14,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  formHelp: {
    fontSize: 12,
    color: '#64748b',
    marginTop: -8,
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  errorTextContainer: {
    flex: 1,
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b91c1c',
  },
  errorMessage: {
    fontSize: 11,
    color: '#7f1d1d',
    marginTop: 2,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1e1b4b',
    minHeight: 48,
  },
  signInButton: {
    marginTop: 4,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  securityNoteText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
  },
  devCard: {
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  devHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  devTag: {
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    color: '#7c3aed',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  devTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  devDescription: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
  },
  quickGrid: {
    gap: 8,
    marginTop: 4,
  },
  quickBtn: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 3,
    minHeight: 48,
    justifyContent: 'center',
  },
  quickBtnTech: {
    borderColor: '#ddd6fe',
    backgroundColor: '#f5f3ff',
  },
  quickBtnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quickRoleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  quickEmailText: {
    fontSize: 11,
    color: '#64748b',
  },
  quickScopeText: {
    fontSize: 10,
    color: '#475569',
    marginTop: 2,
  },
  pillTech: {
    backgroundColor: '#ede9fe',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pillTextTech: {
    fontSize: 8,
    color: '#7c3aed',
    fontWeight: '800',
  },
  pillManager: {
    backgroundColor: '#e0f2fe',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pillTextManager: {
    fontSize: 8,
    color: '#0284c7',
    fontWeight: '800',
  },
  pillViewer: {
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pillTextViewer: {
    fontSize: 8,
    color: '#475569',
    fontWeight: '800',
  },
});
