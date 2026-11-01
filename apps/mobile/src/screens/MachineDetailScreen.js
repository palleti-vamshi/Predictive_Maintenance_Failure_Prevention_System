import React from 'react';
import { StyleSheet, View, Text, ScrollView } from 'react-native';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';
import AlertCallout from '../components/AlertCallout.js';
import { DEMO_ALERTS } from '@predictive-maintenance/shared';

export default function MachineDetailScreen({ machine, onBack, onNavigateAlerts, onNavigateUpload }) {
  if (!machine) return null;

  const machineAlert = DEMO_ALERTS.find((a) => a.machineId === machine.id);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Back Button */}
      <Button
        title="← Back to Assigned Machines"
        variant="ghost"
        onPress={onBack}
        style={styles.backBtn}
        textStyle={styles.backBtnText}
      />

      {/* Machine Header */}
      <View style={styles.headerCard}>
        <View style={styles.badgeRow}>
          <Text style={styles.machineId}>{machine.id}</Text>
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO SPECIMEN</Text>
          </View>
          <StatusBadge status={machine.status} label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'} isSimulated={true} />
        </View>

        <Text style={styles.machineName}>{machine.name}</Text>
        <Text style={styles.subtext}>
          {machine.manufacturer} • Model {machine.model}
        </Text>
        <Text style={styles.locationText}>Location: {machine.site}</Text>
      </View>

      {/* Warning Callout if alert active */}
      {machineAlert && (
        <AlertCallout
          severity={machineAlert.severity}
          title={`Active Warning: ${machineAlert.title}`}
          description={machineAlert.description}
          timestamp={new Date(machineAlert.timestamp).toLocaleTimeString()}
          contributingSignals={machineAlert.contributingSignals}
          isSimulated={true}
          action={
            <Button
              title="Inspect Alert Details →"
              variant="secondary"
              onPress={onNavigateAlerts}
              style={{ marginTop: 6 }}
            />
          }
        />
      )}

      {/* Transmission Stages */}
      <Card title="Mechanical Stages & Ratios">
        {machine.stages.map((stg) => (
          <View key={stg.stage} style={styles.stageItem}>
            <View style={styles.stageHeader}>
              <Text style={styles.stageTitle}>Stage {stg.stage}: {stg.type}</Text>
              <Text style={styles.stageRatio}>{stg.ratio}</Text>
            </View>
            <Text style={styles.stageCondition}>Condition: {stg.condition}</Text>
          </View>
        ))}
        <View style={styles.overallRatioBox}>
          <Text style={styles.overallLabel}>Overall Gearbox Ratio:</Text>
          <Text style={styles.overallVal}>{machine.gearRatio}</Text>
        </View>
      </Card>

      {/* Monitored Sensor Channels */}
      <Card title={`Monitored Sensor Channels (${machine.monitoredSignals.length})`}>
        {machine.monitoredSignals.map((sig) => (
          <View key={sig.key} style={styles.signalRow}>
            <View style={styles.signalMain}>
              <Text style={styles.signalLabel}>{sig.label}</Text>
              <Text style={styles.signalKey}>{sig.key}</Text>
            </View>
            <View style={styles.signalMeta}>
              <View style={[styles.catBadge, sig.category === 'vibration' ? styles.catVib : sig.category === 'thermal' ? styles.catTherm : styles.catReg]}>
                <Text style={styles.catText}>{sig.category.substring(0, 3).toUpperCase()}</Text>
              </View>
              <Text style={styles.unitText}>{sig.unit}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Action Buttons */}
      <View style={styles.actionGrid}>
        <Button
          title="Upload Dataset for GB-104"
          variant="primary"
          onPress={onNavigateUpload}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    paddingBottom: 32,
  },
  backBtn: {
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: 0,
  },
  backBtnText: {
    color: '#38bdf8',
    fontSize: 13,
  },
  headerCard: {
    backgroundColor: '#131d33',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  machineId: {
    fontSize: 14,
    fontWeight: '800',
    color: '#f8fafc',
    fontFamily: 'monospace',
  },
  demoBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  demoBadgeText: {
    color: '#d8b4fe',
    fontSize: 9,
    fontWeight: '800',
  },
  machineName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtext: {
    fontSize: 13,
    color: '#94a3b8',
  },
  locationText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  stageItem: {
    backgroundColor: '#0f172a',
    borderRadius: 6,
    padding: 10,
    gap: 2,
  },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stageTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f8fafc',
  },
  stageRatio: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38bdf8',
    fontFamily: 'monospace',
  },
  stageCondition: {
    fontSize: 11,
    color: '#94a3b8',
  },
  overallRatioBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(2, 132, 199, 0.1)',
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  overallLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f8fafc',
  },
  overallVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#38bdf8',
    fontFamily: 'monospace',
  },
  signalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  signalMain: {
    flex: 1,
  },
  signalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f8fafc',
  },
  signalKey: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  signalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  catVib: { backgroundColor: 'rgba(245, 158, 11, 0.2)' },
  catTherm: { backgroundColor: 'rgba(244, 63, 94, 0.2)' },
  catReg: { backgroundColor: 'rgba(14, 165, 233, 0.2)' },
  catText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#f8fafc',
    fontFamily: 'monospace',
  },
  unitText: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
    minWidth: 40,
    textAlign: 'right',
  },
  actionGrid: {
    gap: 10,
    marginTop: 4,
  },
});

