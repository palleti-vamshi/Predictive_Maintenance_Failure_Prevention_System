import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Card from '../components/Card.js';
import Button from '../components/Button.js';
import StatusBadge from '../components/StatusBadge.js';
import { DEMO_MACHINES } from '@predictive-maintenance/shared';

export default function UploadDatasetScreen() {
  const [selectedMachine, setSelectedMachine] = useState(DEMO_MACHINES[0].id);
  const [datasetType, setDatasetType] = useState('operational');
  const [fileAttached, setFileAttached] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>DATASET CHECK-IN</Text>
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
        </View>
        <Text style={styles.title}>Upload Sensor Dataset</Text>
        <Text style={styles.subtitle}>
          Check in historical CSV runs for automated condition analysis and baseline comparison.
        </Text>
      </View>

      {/* Target Equipment Selector */}
      <Card title="1. Select Gearbox Equipment">
        <View style={styles.selectorRow}>
          {DEMO_MACHINES.map((m) => {
            const isSelected = m.id === selectedMachine;
            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => setSelectedMachine(m.id)}
                style={[styles.selectorBtn, isSelected && styles.selectorBtnActive]}
                accessibilityRole="button"
              >
                <Text style={[styles.selectorBtnText, isSelected && styles.selectorBtnTextActive]}>
                  {m.id}
                </Text>
                <Text style={styles.selectorSubtext}>{m.name.split(' ')[0]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* Provenance Selector */}
      <Card title="2. Dataset Provenance Category">
        <TouchableOpacity
          style={[styles.typeOption, datasetType === 'operational' && styles.typeOptionActive]}
          onPress={() => setDatasetType('operational')}
        >
          <View style={styles.radioDot}>
            {datasetType === 'operational' && <View style={styles.radioDotInner} />}
          </View>
          <View style={styles.typeContent}>
            <Text style={styles.typeTitle}>Operational Run</Text>
            <Text style={styles.typeDesc}>Real factory floor measurements</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.typeOption, datasetType === 'simulated' && styles.typeOptionActive]}
          onPress={() => setDatasetType('simulated')}
        >
          <View style={styles.radioDot}>
            {datasetType === 'simulated' && <View style={styles.radioDotInner} />}
          </View>
          <View style={styles.typeContent}>
            <Text style={styles.typeTitle}>Simulated / Testbed</Text>
            <Text style={styles.typeDesc}>Synthetically generated or lab run</Text>
          </View>
        </TouchableOpacity>
      </Card>

      {/* File Upload Zone */}
      <Card title="3. Attach CSV Dataset File">
        <TouchableOpacity
          style={styles.dropzone}
          onPress={() => setFileAttached(!fileAttached)}
          activeOpacity={0.7}
        >
          <Text style={styles.dropzoneIcon}>📁</Text>
          <Text style={styles.dropzoneTitle}>
            {fileAttached ? 'GB104_field_run_demo.csv' : 'Choose CSV Dataset File'}
          </Text>
          <Text style={styles.dropzoneDesc}>
            {fileAttached ? '2.4 MB • 24,000 samples @ 100 Hz' : 'Tap to select CSV file from device storage'}
          </Text>
          <StatusBadge
            status={fileAttached ? 'healthy' : 'info'}
            label={fileAttached ? 'ATTACHED [DEMO]' : 'AWAITING FILE'}
            isSimulated={true}
            style={{ marginTop: 6 }}
          />
        </TouchableOpacity>

        <Button
          title={fileAttached ? 'Submit Dataset for Analysis (Demo)' : 'Upload & Validate'}
          variant="primary"
          disabled={!fileAttached}
          onPress={() => alert('Dataset check-in workflow will process uploads in Phase 5.')}
        />
      </Card>

      {/* Validation Checklist */}
      <Card title="Data Integrity Validation Checks">
        <View style={styles.checkRow}>
          <Text style={styles.checkIcon}>✓</Text>
          <Text style={styles.checkText}>Monotonic Timestamps (No backwards jumps)</Text>
        </View>
        <View style={styles.checkRow}>
          <Text style={styles.checkIcon}>✓</Text>
          <Text style={styles.checkText}>Sampling Gap Detection (&gt;500ms intervals)</Text>
        </View>
        <View style={styles.checkRow}>
          <Text style={styles.checkIcon}>✓</Text>
          <Text style={styles.checkText}>Physical Sensor Bounds Verification</Text>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    paddingBottom: 32,
  },
  headerBox: {
    backgroundColor: '#131d33',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38bdf8',
    letterSpacing: 0.5,
  },
  demoBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  demoBadgeText: {
    color: '#d8b4fe',
    fontSize: 9,
    fontWeight: '800',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  selectorRow: {
    flexDirection: 'row',
    gap: 10,
  },
  selectorBtn: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  selectorBtnActive: {
    borderColor: '#0284c7',
    backgroundColor: 'rgba(2, 132, 199, 0.1)',
  },
  selectorBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  selectorBtnTextActive: {
    color: '#38bdf8',
  },
  selectorSubtext: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
  },
  typeOptionActive: {
    borderColor: '#0284c7',
  },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38bdf8',
  },
  typeContent: {
    flex: 1,
  },
  typeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  typeDesc: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 1,
  },
  dropzone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#334155',
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    gap: 4,
  },
  dropzoneIcon: {
    fontSize: 32,
  },
  dropzoneTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  dropzoneDesc: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkIcon: {
    color: '#10b981',
    fontWeight: '800',
    fontSize: 14,
  },
  checkText: {
    color: '#94a3b8',
    fontSize: 12,
  },
});

