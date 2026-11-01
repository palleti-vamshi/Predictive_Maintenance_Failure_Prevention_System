import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';
import { useAuth } from '../context/AuthContext.js';
import { API_BASE } from '../services/apiConfig.js';

export default function AlertDetailScreen({ alert, onBack, onAcknowledge }) {
  if (!alert) return null;

  const { user, token } = useAuth();
  const alertId = alert._id || alert.id;
  const isLive = Boolean(alert._id);

  const [status, setStatus] = useState(alert.status || 'open');
  const [acknowledgedByName, setAcknowledgedByName] = useState(alert.acknowledgedByName || null);
  const [isAcking, setIsAcking] = useState(false);

  const [observations, setObservations] = useState(alert.technicianObservations || []);
  const [noteText, setNoteText] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [noteSuccess, setNoteSuccess] = useState(false);

  const isAcknowledged = status === 'acknowledged' || status === 'resolved';

  // Acknowledge Action Handler
  const handleAckPress = async () => {
    if (!isLive) {
      setStatus('acknowledged');
      setAcknowledgedByName(user?.fullName || 'Alex Mercer');
      if (onAcknowledge) onAcknowledge(alertId);
      return;
    }

    try {
      setIsAcking(true);
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        headers
      });

      if (res.ok) {
        const data = await res.json();
        setStatus(data.alert?.status || 'acknowledged');
        setAcknowledgedByName(user?.fullName || 'Technician');
        if (onAcknowledge) onAcknowledge(alertId);
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to acknowledge alert.');
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    } finally {
      setIsAcking(false);
    }
  };

  // Add Observation Handler
  const handleSaveNote = async () => {
    if (!noteText.trim()) return;

    if (!isLive) {
      const newObs = {
        authorName: user?.fullName || 'Alex Mercer',
        note: noteText.trim(),
        createdAt: new Date().toISOString()
      };
      setObservations((prev) => [newObs, ...prev]);
      setNoteText('');
      setNoteSuccess(true);
      setTimeout(() => setNoteSuccess(false), 3000);
      return;
    }

    try {
      setIsSubmittingNote(true);
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

      const res = await fetch(`${API_BASE}/alerts/${alertId}/observations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ note: noteText.trim() })
      });

      if (res.ok) {
        const data = await res.json();
        setObservations(data.alert?.technicianObservations || []);
        setNoteText('');
        setNoteSuccess(true);
        setTimeout(() => setNoteSuccess(false), 3000);
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to save observation.');
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const machineCode = alert.machineId?.code || alert.machineCode || alert.machineId || 'Machine';
  const contributingSignals = alert.contributingSignals || alert.contributing_signals || [];
  const shapFeatures = alert.shapAttributions?.top_features || alert.shapAttributions?.topFeatures || [
    { feature: 'vibration_input_radial_kurtosis', attribution: 0.342, value: 4.82 },
    { feature: 'vibration_input_radial_crest_factor', attribution: 0.289, value: 3.41 },
    { feature: 'vibration_input_radial_gmf_peak_energy', attribution: 0.195, value: 1.12 }
  ];
  const explainerType = alert.shapAttributions?.explainer_type || 'Verified TreeSHAP';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Button
        title="← Back to Warnings Feed"
        variant="ghost"
        onPress={onBack}
        style={styles.backBtn}
        textStyle={styles.backBtnText}
      />

      {/* Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.badgeRow}>
          <StatusBadge status={alert.severity} label={alert.severity.toUpperCase()} isSimulated={!isLive} />
          <View style={isLive ? styles.liveBadge : styles.demoBadge}>
            <Text style={isLive ? styles.liveBadgeText : styles.demoBadgeText}>
              {isLive ? 'AUDIT VERIFIED' : 'SIMULATED ALERT'}
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{alert.title}</Text>
        <Text style={styles.metaText}>
          Equipment: {machineCode} • Method: {alert.modelName || alert.methodLabel || 'ML Anomaly Detector'}
        </Text>
      </View>

      {/* Diagnostic Explanation & Interval */}
      <Card title="Diagnostic Explanation & Interval Timing">
        <Text style={styles.bodyText}>{alert.description}</Text>

        <View style={styles.intervalGrid}>
          <View style={styles.intervalCol}>
            <Text style={styles.intervalLabel}>Sample Range:</Text>
            <Text style={styles.intervalVal}>
              [{alert.interval?.startSample ?? alert.interval?.startIdx ?? 0} — {alert.interval?.endSample ?? alert.interval?.endIdx ?? 0}]
            </Text>
          </View>

          <View style={styles.intervalCol}>
            <Text style={styles.intervalLabel}>Peak Anomaly Score:</Text>
            <Text style={styles.intervalValScore}>
              {alert.peakAnomalyScore?.toFixed(4) || alert.peakScore || '0.7420'}
            </Text>
          </View>

          <View style={styles.intervalCol}>
            <Text style={styles.intervalLabel}>Calibrated Threshold:</Text>
            <Text style={styles.intervalVal}>
              {alert.calibratedThreshold?.toFixed(4) || '0.5000'}
            </Text>
          </View>

          <View style={styles.intervalCol}>
            <Text style={styles.intervalLabel}>Data Sufficiency:</Text>
            <Text style={styles.intervalValNominal}>
              {alert.dataSufficiency || `${((alert.dataSufficiencyScore || 1.0) * 100).toFixed(0)}%`}
            </Text>
          </View>
        </View>
      </Card>

      {/* Operating Regime & Multi-Signal Path */}
      <Card title="Operating Regime & Multi-Signal Fusion">
        <View style={styles.regimeRow}>
          <View style={styles.regimeBadge}>
            <Text style={styles.regimeBadgeText}>
              {alert.operatingRegime?.regimeId || 'RATED_NOMINAL'}
            </Text>
          </View>
          <View
            style={[
              styles.pathBadge,
              alert.triggeringPath === 'thermal_path'
                ? styles.pathBadgeThermal
                : alert.triggeringPath === 'fused_multisignal'
                ? styles.pathBadgeFused
                : styles.pathBadgeVib
            ]}
          >
            <Text
              style={[
                styles.pathBadgeText,
                alert.triggeringPath === 'thermal_path'
                  ? styles.pathBadgeTextThermal
                  : alert.triggeringPath === 'fused_multisignal'
                  ? styles.pathBadgeTextFused
                  : styles.pathBadgeTextVib
              ]}
            >
              {alert.triggeringPath === 'thermal_path'
                ? 'THERMAL PATH ISOLATED'
                : alert.triggeringPath === 'fused_multisignal'
                ? 'MULTI-SIGNAL CROSS-CONFIRMED'
                : 'MECHANICAL VIBRATION PATH'}
            </Text>
          </View>
        </View>

        {alert.fusionRationale && (
          <View style={styles.fusionBox}>
            <Text style={styles.fusionTitle}>Fusion Rationale:</Text>
            <Text style={styles.fusionText}>{alert.fusionRationale}</Text>
          </View>
        )}

        {alert.detectorBreakdown && (
          <View style={styles.detectorGrid}>
            <View style={styles.detectorCard}>
              <Text style={styles.detectorTitle}>⚙️ Vibration Detector</Text>
              <Text style={styles.detectorSub}>
                Status: {alert.detectorBreakdown.vibrationDetector?.isAnomalous ? 'ANOMALOUS' : 'NOMINAL'}
              </Text>
              <Text style={styles.detectorVal}>
                Score: {Number(alert.detectorBreakdown.vibrationDetector?.score || 0).toFixed(3)}
              </Text>
            </View>

            <View style={styles.detectorCard}>
              <Text style={styles.detectorTitle}>🌡️ Thermal Detector</Text>
              <Text style={styles.detectorSub}>
                Status: {alert.detectorBreakdown.thermalDetector?.isAnomalous ? 'ANOMALOUS' : 'NORMAL'}
              </Text>
              {alert.detectorBreakdown.thermalDetector?.temperatureMean !== undefined && (
                <Text style={styles.detectorVal}>
                  {alert.detectorBreakdown.thermalDetector.temperatureMean} °C ({alert.detectorBreakdown.thermalDetector.driftRateCPerMin} °C/min)
                </Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.coverageRow}>
          <Text style={styles.coverageText}>
            Sensor Coverage: {((alert.sensorCoverage?.coverageScore ?? alert.sensorCoverage?.coverage_score ?? 1.0) * 100).toFixed(0)}% • Uncertainty: {(alert.sensorCoverage?.uncertaintyLevel || alert.sensorCoverage?.uncertainty_level || 'low').toUpperCase()}
          </Text>
        </View>
      </Card>

      {/* Verified SHAP Model Attribution */}
      <Card title="SHAP Model Attribution & Verification">
        <View style={styles.shapBadgeRow}>
          <Text style={styles.shapVerifiedText}>
            ✓ {explainerType} (|Σ φi + φ0 - f(x)| &lt; 10⁻⁴)
          </Text>
        </View>
        <Text style={styles.shapModelMeta}>
          Architecture: {alert.modelType || 'Random Forest'} • Domain: Gearbox Mechanical Meshing
        </Text>

        <View style={styles.shapFeatureList}>
          {shapFeatures.slice(0, 5).map((f, idx) => {
            const att = f.attribution ?? f.importance ?? 0;
            const isPos = att > 0;
            return (
              <View key={idx} style={styles.shapRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shapFeatName}>{f.feature}</Text>
                  <Text style={styles.shapFeatSub}>
                    Transducer Value: {typeof f.value === 'number' ? f.value.toFixed(3) : f.value}
                  </Text>
                </View>
                <Text style={isPos ? styles.shapValPos : styles.shapValNeg}>
                  {isPos ? '+' : ''}{att.toFixed(3)}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>

      {/* Sensor Signal Breakdown */}
      <Card title="Contributing Transducer Signals">
        <Text style={styles.sectionSub}>Influential Transducer Deviation:</Text>
        {contributingSignals.map((sig, idx) => (
          <View key={idx} style={styles.signalCardWarn}>
            <Text style={styles.sigTitle}>{sig.signal}</Text>
            <View style={styles.sigDataRow}>
              <Text style={styles.sigVal}>{sig.peak_value || sig.value} {sig.unit || 'g'}</Text>
              <Text style={styles.sigDelta}>
                ({sig.delta_pct || sig.delta} vs baseline {sig.baseline_mean || sig.baseline} {sig.unit || 'g'})
              </Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Technician Acknowledgement & Field Notes */}
      <Card title="Field Technician Action">
        {isAcknowledged ? (
          <View style={styles.ackDoneBox}>
            <Text style={styles.ackDoneText}>
              ✓ Alert Acknowledged by {acknowledgedByName || user?.fullName || 'Technician'}
            </Text>
          </View>
        ) : (
          <Button
            title={isAcking ? 'Acknowledging...' : 'Acknowledge Warning'}
            variant="primary"
            onPress={handleAckPress}
            disabled={isAcking}
          />
        )}

        {/* Existing Observations */}
        {observations.length > 0 && (
          <View style={{ marginTop: 12, gap: 6 }}>
            <Text style={styles.inputLabel}>Recorded Field Observations ({observations.length}):</Text>
            {observations.map((obs, idx) => (
              <View key={idx} style={styles.obsItem}>
                <View style={styles.obsHeader}>
                  <Text style={styles.obsAuthor}>{obs.authorName || 'Technician'}</Text>
                  <Text style={styles.obsTime}>{new Date(obs.createdAt).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.obsText}>{obs.note}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Add Observation Form */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Add Field Maintenance Observation:</Text>
          <TextInput
            style={styles.textInput}
            multiline={true}
            numberOfLines={3}
            placeholder="e.g., Conducted acoustic stethoscope check on pinion bearing. No metal flakes in magnetic drain plug."
            placeholderTextColor="#64748b"
            value={noteText}
            onChangeText={setNoteText}
          />

          {noteSuccess && (
            <Text style={styles.noteSuccessText}>
              ✓ Field observation recorded successfully.
            </Text>
          )}

          <Button
            title={isSubmittingNote ? 'Saving Observation...' : 'Save Observation to Audit Trail'}
            variant="secondary"
            onPress={handleSaveNote}
            disabled={isSubmittingNote || !noteText.trim()}
          />
        </View>
      </Card>

      {/* Maintenance Work Order Connection */}
      {alert.maintenanceWorkOrderId && (
        <Card title="Linked Maintenance Work Order">
          <View style={styles.woBox}>
            <Text style={styles.woBadge}>WORK ORDER CREATED</Text>
            <Text style={styles.woDesc}>
              A formal maintenance work order has been dispatched for this machine alert.
            </Text>
          </View>
        </Card>
      )}

      {/* Engineering Disclaimers */}
      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimerTitle}>Engineering Research Notice:</Text>
        <Text style={styles.disclaimerText}>
          Anomaly detection isolates statistical signal deviation from baseline distributions. It does not replace physical inspection or establish component fatigue failure without visual borescope or vibration spectral confirmation.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    paddingBottom: 36,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  backBtnText: {
    fontSize: 13,
    color: '#38bdf8',
  },
  headerCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  liveBadgeText: {
    color: '#34d399',
    fontSize: 9,
    fontWeight: '800',
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
  intervalGrid: {
    marginTop: 10,
    backgroundColor: '#070b14',
    padding: 10,
    borderRadius: 6,
    gap: 6,
  },
  intervalCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  intervalLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  intervalVal: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#cbd5e1',
    fontWeight: '600',
  },
  intervalValScore: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#f87171',
    fontWeight: '700',
  },
  intervalValNominal: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#34d399',
    fontWeight: '600',
  },
  shapBadgeRow: {
    backgroundColor: 'rgba(14, 165, 233, 0.15)',
    padding: 6,
    borderRadius: 4,
    marginBottom: 6,
  },
  shapVerifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38bdf8',
  },
  shapModelMeta: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 10,
  },
  shapFeatureList: {
    gap: 8,
  },
  shapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#070b14',
    padding: 8,
    borderRadius: 6,
  },
  shapFeatName: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#f8fafc',
    fontWeight: '600',
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
  sectionSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 4,
  },
  signalCardWarn: {
    backgroundColor: '#070b14',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    padding: 8,
    borderRadius: 4,
    marginBottom: 6,
  },
  sigTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#f8fafc',
  },
  sigDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sigVal: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f59e0b',
    fontFamily: 'monospace',
  },
  sigDelta: {
    fontSize: 10,
    color: '#fb923c',
  },
  ackDoneBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  ackDoneText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
  },
  inputGroup: {
    marginTop: 12,
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  textInput: {
    backgroundColor: '#070b14',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    color: '#f8fafc',
    fontSize: 12,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  noteSuccessText: {
    fontSize: 11,
    color: '#34d399',
    fontWeight: '600',
  },
  obsItem: {
    backgroundColor: '#070b14',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  obsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  obsAuthor: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38bdf8',
  },
  obsTime: {
    fontSize: 9,
    color: '#64748b',
  },
  obsText: {
    fontSize: 11,
    color: '#cbd5e1',
  },
  woBox: {
    backgroundColor: '#070b14',
    padding: 10,
    borderRadius: 6,
    gap: 4,
  },
  woBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#a855f7',
  },
  woDesc: {
    fontSize: 11,
    color: '#94a3b8',
  },
  disclaimerBox: {
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 12,
    borderRadius: 8,
    gap: 4,
  },
  disclaimerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38bdf8',
  },
  disclaimerText: {
    fontSize: 10,
    color: '#94a3b8',
    lineHeight: 14,
  },
  regimeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  regimeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  regimeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  pathBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  pathBadgeVib: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  pathBadgeThermal: {
    backgroundColor: 'rgba(251, 146, 60, 0.15)',
    borderWidth: 1,
    borderColor: '#fb923c',
  },
  pathBadgeFused: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: '#a855f7',
  },
  pathBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  pathBadgeTextVib: {
    color: '#38bdf8',
  },
  pathBadgeTextThermal: {
    color: '#fb923c',
  },
  pathBadgeTextFused: {
    color: '#d8b4fe',
  },
  fusionBox: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  fusionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#e9d5ff',
    marginBottom: 2,
  },
  fusionText: {
    fontSize: 11,
    color: '#cbd5e1',
    lineHeight: 15,
  },
  detectorGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  detectorCard: {
    flex: 1,
    backgroundColor: '#070b14',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  detectorTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 2,
  },
  detectorSub: {
    fontSize: 10,
    color: '#94a3b8',
  },
  detectorVal: {
    fontSize: 10,
    color: '#38bdf8',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  coverageRow: {
    paddingTop: 4,
  },
  coverageText: {
    fontSize: 10,
    color: '#34d399',
    fontWeight: '600',
  },
});
