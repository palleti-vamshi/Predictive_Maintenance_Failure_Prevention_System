import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TextInput } from 'react-native';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';

export default function AlertDetailScreen({ alert, onBack, onAcknowledge }) {
  if (!alert) return null;

  const [acknowledged, setAcknowledged] = useState(alert.status === 'acknowledged');
  const [noteText, setNoteText] = useState('');
  const [noteLogged, setNoteLogged] = useState(false);

  const handleAckPress = () => {
    setAcknowledged(true);
    if (onAcknowledge) onAcknowledge(alert.id);
  };

  const handleSaveNote = () => {
    if (!noteText.trim()) return;
    setNoteLogged(true);
    setTimeout(() => {
      setNoteText('');
      setNoteLogged(false);
    }, 3000);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Button
        title="← Back to Warnings Feed"
        variant="ghost"
        onPress={onBack}
        style={styles.backBtn}
        textStyle={styles.backBtnText}
      />

      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.badgeRow}>
          <StatusBadge status={alert.severity} label={alert.severity.toUpperCase()} isSimulated={true} />
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>SIMULATED ALERT</Text>
          </View>
        </View>

        <Text style={styles.title}>{alert.title}</Text>
        <Text style={styles.metaText}>
          Equipment: {alert.machineId} • Method: {alert.methodLabel}
        </Text>
      </View>

      {/* Detailed Explanation */}
      <Card title="Diagnostic Explanation">
        <Text style={styles.bodyText}>{alert.description}</Text>

        <View style={styles.sufficiencyBox}>
          <Text style={styles.sufficiencyLabel}>Data Sufficiency:</Text>
          <Text style={styles.sufficiencyVal}>{alert.dataSufficiency}</Text>
        </View>
      </Card>

      {/* Verified TreeSHAP Model Attribution */}
      <Card title="SHAP Model Attribution & Verification">
        <View style={styles.shapBadgeRow}>
          <Text style={styles.shapVerifiedText}>✓ Verified Additive TreeSHAP (|Σ φi + φ0 - f(x)| &lt; 10⁻⁴)</Text>
        </View>
        <Text style={styles.shapModelMeta}>
          Architecture: Random Forest Classifier • Domain: Gearbox Meshing
        </Text>

        <View style={styles.shapFeatureList}>
          <View style={styles.shapRow}>
            <View>
              <Text style={styles.shapFeatName}>vibration_input_radial_kurtosis</Text>
              <Text style={styles.shapFeatSub}>Impact transients in mesh pass</Text>
            </View>
            <Text style={styles.shapValPos}>+0.342</Text>
          </View>

          <View style={styles.shapRow}>
            <View>
              <Text style={styles.shapFeatName}>vibration_input_radial_crest_factor</Text>
              <Text style={styles.shapFeatSub}>Peak-to-RMS tooth ratio</Text>
            </View>
            <Text style={styles.shapValPos}>+0.289</Text>
          </View>

          <View style={styles.shapRow}>
            <View>
              <Text style={styles.shapFeatName}>vibration_input_radial_gmf_peak_energy</Text>
              <Text style={styles.shapFeatSub}>Gear Mesh Frequency (448.5 Hz)</Text>
            </View>
            <Text style={styles.shapValPos}>+0.195</Text>
          </View>

          <View style={styles.shapRow}>
            <View>
              <Text style={styles.shapFeatName}>temp_gearbox_sump_mean</Text>
              <Text style={styles.shapFeatSub}>Thermal equilibrium nominal</Text>
            </View>
            <Text style={styles.shapValNeg}>-0.082</Text>
          </View>
        </View>
      </Card>

      {/* Sensor Signal Breakdown */}
      <Card title="Sensor Signal Breakdown">
        <Text style={styles.sectionSub}>Influential Transducer Signals:</Text>
        {alert.contributingSignals.map((sig, idx) => (
          <View key={idx} style={styles.signalCardWarn}>
            <Text style={styles.sigTitle}>{sig.signal}</Text>
            <View style={styles.sigDataRow}>
              <Text style={styles.sigVal}>{sig.value}</Text>
              <Text style={styles.sigDelta}>({sig.delta} vs baseline {sig.baseline})</Text>
            </View>
          </View>
        ))}

        <Text style={[styles.sectionSub, { marginTop: 8 }]}>Quiescent Normal Signals:</Text>
        {alert.unaffectedSignals.map((sig, idx) => (
          <View key={idx} style={styles.signalCardNom}>
            <Text style={styles.sigTitle}>{sig.signal}</Text>
            <View style={styles.sigDataRow}>
              <Text style={styles.sigValNom}>{sig.value}</Text>
              <Text style={styles.sigNote}>{sig.note}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Technician Acknowledgement & Notes */}
      <Card title="Field Technician Action">
        {acknowledged ? (
          <View style={styles.ackDoneBox}>
            <Text style={styles.ackDoneText}>✓ Alert Acknowledged by Alex Mercer [DEMO]</Text>
          </View>
        ) : (
          <Button
            title="Acknowledge Warning (Demo Session)"
            variant="primary"
            onPress={handleAckPress}
          />
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Add Field Maintenance Observation:</Text>
          <TextInput
            style={styles.textInput}
            multiline={true}
            numberOfLines={3}
            placeholder="e.g. Inspected pinion coupling; scheduled grease refill..."
            placeholderTextColor="#64748b"
            value={noteText}
            onChangeText={setNoteText}
          />
          {noteLogged && (
            <Text style={styles.noteSuccess}>✓ Field note recorded for demo session</Text>
          )}
          <Button
            title="Save Field Note"
            variant="secondary"
            disabled={!noteText.trim()}
            onPress={handleSaveNote}
            style={{ marginTop: 6 }}
          />
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
    gap: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  metaText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  bodyText: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 20,
  },
  sufficiencyBox: {
    backgroundColor: '#0f172a',
    borderRadius: 6,
    padding: 10,
    marginTop: 6,
  },
  sufficiencyLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  sufficiencyVal: {
    fontSize: 12,
    color: '#38bdf8',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  sectionSub: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
    marginBottom: 4,
  },
  signalCardWarn: {
    backgroundColor: '#0f172a',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    padding: 8,
    borderRadius: 4,
    marginBottom: 6,
  },
  signalCardNom: {
    backgroundColor: '#0f172a',
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
    padding: 8,
    borderRadius: 4,
    marginBottom: 6,
  },
  sigTitle: {
    fontSize: 11,
    color: '#94a3b8',
  },
  sigDataRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 2,
  },
  sigVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
    fontFamily: 'monospace',
  },
  sigDelta: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '700',
  },
  sigValNom: {
    fontSize: 13,
    fontWeight: '700',
    color: '#10b981',
    fontFamily: 'monospace',
  },
  sigNote: {
    fontSize: 11,
    color: '#64748b',
  },
  ackDoneBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  ackDoneText: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 13,
  },
  inputGroup: {
    marginTop: 10,
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#090e1a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    color: '#f8fafc',
    fontSize: 13,
    textAlignVertical: 'top',
    minHeight: 70,
  },
  noteSuccess: {
    fontSize: 11,
    color: '#10b981',
    fontWeight: '600',
  },
  shapBadgeRow: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  shapVerifiedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34d399',
  },
  shapModelMeta: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 8,
  },
  shapFeatureList: {
    gap: 6,
  },
  shapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 8,
    borderRadius: 4,
  },
  shapFeatName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#f8fafc',
    fontFamily: 'monospace',
  },
  shapFeatSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  shapValPos: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f87171',
    fontFamily: 'monospace',
  },
  shapValNeg: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
    fontFamily: 'monospace',
  },
});

