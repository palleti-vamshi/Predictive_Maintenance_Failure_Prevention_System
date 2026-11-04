import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Card from '../components/Card.js';
import StatusBadge from '../components/StatusBadge.js';
import Button from '../components/Button.js';
import AlertCallout from '../components/AlertCallout.js';
import { WORK_ORDER_STATUS } from '@predictive-maintenance/shared';
import { useAuth } from '../context/AuthContext.js';
import { API_BASE } from '../services/apiConfig.js';

export default function MachineDetailScreen({
  machine: initialMachine,
  onBack,
  onNavigateAlerts,
  onNavigateUpload
}) {
  const { token, user } = useAuth();
  const machineId = initialMachine?.id || initialMachine?.code || 'GB-104';

  const [machine, setMachine] = useState(initialMachine);
  const [workOrders, setWorkOrders] = useState([]);
  const [machineAlerts, setMachineAlerts] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Field note state
  const [noteContent, setNoteContent] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteSuccess, setNoteSuccess] = useState(false);

  // Work order completion state
  const [completingOrderId, setCompletingOrderId] = useState(null);
  const [findings, setFindings] = useState('');
  const [workPerformed, setWorkPerformed] = useState('');

  const loadWorkOrders = useCallback(async () => {
    if (!token) return;
    setLoadingOrders(true);
    try {
      const res = await fetch(`${API_BASE}/machines/${machineId}/work-orders`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setWorkOrders(data.workOrders || []);
      }
    } catch (err) {
      console.warn('[MachineDetailScreen] Error loading work orders:', err.message);
    } finally {
      setLoadingOrders(false);
    }
  }, [machineId, token]);

  const loadMachineAlerts = useCallback(async () => {
    if (!token) return;
    try {
      const dbId = machine?.dbId || machine?._id;
      const url = dbId ? `${API_BASE}/alerts?machineId=${dbId}` : `${API_BASE}/alerts`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setMachineAlerts(data.alerts || []);
      }
    } catch (err) {
      console.warn('[MachineDetailScreen] Error loading alerts:', err.message);
    }
  }, [machine?.dbId, machine?._id, token]);

  useEffect(() => {
    loadWorkOrders();
    loadMachineAlerts();
  }, [loadWorkOrders, loadMachineAlerts]);

  // Submit field note
  const handleSubmitNote = async () => {
    if (!noteContent.trim() || !token) return;
    setNoteSubmitting(true);
    setNoteSuccess(false);

    try {
      const res = await fetch(`${API_BASE}/machines/${machineId}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          content: noteContent.trim(),
          category: 'Field Observation'
        })
      });

      if (!res.ok) {
        const data = await res.json();
        Alert.alert('Error', data.message || 'Failed to submit field note.');
        return;
      }

      setNoteContent('');
      setNoteSuccess(true);
      setTimeout(() => setNoteSuccess(false), 3000);
    } catch (err) {
      Alert.alert('Network Error', err.message);
    } finally {
      setNoteSubmitting(false);
    }
  };

  // Update Work Order Status
  const handleUpdateOrderStatus = async (orderId, targetStatus, feedback = {}) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          status: targetStatus,
          ...feedback
        })
      });

      if (!res.ok) {
        const data = await res.json();
        Alert.alert('Action Blocked', data.message || 'Status update failed.');
        return;
      }

      setCompletingOrderId(null);
      setFindings('');
      setWorkPerformed('');
      loadWorkOrders();
    } catch (err) {
      Alert.alert('Network Error', err.message);
    }
  };

  if (!machine) return null;

  const isDecomm = machine.isDecommissioned || machine.operationalStatus === 'decommissioned';
  const machineAlert = machineAlerts.find((a) => a.status === 'active' || a.status === 'open' || a.status === 'acknowledged') || machineAlerts[0];
  const stages = machine.stages || [];
  const signals = machine.monitoredSignals || [];

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
          <Text style={styles.machineId}>{machineId}</Text>
          <View style={styles.operationalBadge}>
            <Text style={styles.operationalBadgeText}>
              {machine.operationalStatus?.toUpperCase() || 'OPERATIONAL'}
            </Text>
          </View>
          <StatusBadge
            status={machine.status}
            label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'}
            isSimulated={!machine.isLive}
          />
        </View>

        <Text style={styles.machineName}>{machine.name}</Text>
        <Text style={styles.subtext}>
          {machine.manufacturer} • Model {machine.model}
        </Text>
        <Text style={styles.locationText}>
          Location: {machine.site || machine.siteId?.name || 'Detroit Plant #2'}
        </Text>
      </View>

      {/* Decommission Notice */}
      {isDecomm && (
        <View style={styles.decommBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="alert-octagon" size={15} color="#dc2626" />
            <Text style={styles.decommTitle}>Soft-Decommissioned Gearbox</Text>
          </View>
          <Text style={styles.decommDesc}>
            This gearbox has been taken out of active operational rotation. Uploads and new work orders are disabled.
          </Text>
        </View>
      )}

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

      {/* Assigned Maintenance Work Orders */}
      <Card
        title={`Maintenance Work Orders (${workOrders.length})`}
        subtitle="Assigned field work orders and task execution"
      >
        {loadingOrders ? (
          <ActivityIndicator size="small" color="#38bdf8" />
        ) : workOrders.length === 0 ? (
          <Text style={styles.emptyText}>No work orders currently assigned to this machine.</Text>
        ) : (
          workOrders.map((order) => {
            const isAssignedToUser = order.assignedTechnicianId?._id === user?._id;
            const canUpdate = isAssignedToUser || user?.role === 'factory_manager';

            return (
              <View key={order._id} style={styles.orderBox}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderNumber}>{order.orderNumber}</Text>
                  <View style={styles.orderBadges}>
                    <View style={[styles.prioBadge, order.priority === 'urgent' || order.priority === 'high' ? styles.prioHigh : styles.prioMed]}>
                      <Text style={styles.prioText}>{order.priority?.toUpperCase()}</Text>
                    </View>
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>{order.status?.toUpperCase()}</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.orderTitle}>{order.title}</Text>
                <Text style={styles.orderDesc}>{order.description}</Text>
                <Text style={styles.orderDue}>Due: {new Date(order.dueDate).toLocaleDateString()}</Text>

                {/* Technician feedback if present */}
                {order.technicianFeedback?.findings && (
                  <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackTitle}>Inspection Report:</Text>
                    <Text style={styles.feedbackText}>{order.technicianFeedback.findings}</Text>
                    {order.technicianFeedback.workPerformed && (
                      <Text style={styles.feedbackText}>Work: {order.technicianFeedback.workPerformed}</Text>
                    )}
                  </View>
                )}

                {/* Action Buttons for Technician */}
                {canUpdate && order.status === WORK_ORDER_STATUS.OPEN && (
                  <Button
                    title="Accept Work Order"
                    variant="secondary"
                    onPress={() => handleUpdateOrderStatus(order._id, WORK_ORDER_STATUS.ACCEPTED, { note: 'Accepted on mobile terminal' })}
                    style={styles.orderActionBtn}
                  />
                )}

                {canUpdate && (order.status === WORK_ORDER_STATUS.OPEN || order.status === WORK_ORDER_STATUS.ACCEPTED) && (
                  <Button
                    title="Start Field Work"
                    variant="primary"
                    onPress={() => handleUpdateOrderStatus(order._id, WORK_ORDER_STATUS.IN_PROGRESS, { note: 'Started work via mobile terminal' })}
                    style={styles.orderActionBtn}
                  />
                )}

                {canUpdate && order.status === WORK_ORDER_STATUS.IN_PROGRESS && (
                  completingOrderId === order._id ? (
                    <View style={styles.completionForm}>
                      <Text style={styles.inputLabel}>Inspection Findings *</Text>
                      <TextInput
                        style={styles.textInput}
                        placeholder="e.g. Backlash nominal; slight seal weeping"
                        placeholderTextColor="#64748b"
                        value={findings}
                        onChangeText={setFindings}
                      />
                      <Text style={styles.inputLabel}>Work Performed *</Text>
                      <TextInput
                        style={styles.textInput}
                        placeholder="e.g. Torqued bolts; replenished 250ml oil"
                        placeholderTextColor="#64748b"
                        value={workPerformed}
                        onChangeText={setWorkPerformed}
                      />
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        <Button
                          title="Submit & Complete"
                          variant="primary"
                          onPress={() => handleUpdateOrderStatus(order._id, WORK_ORDER_STATUS.COMPLETED, {
                            findings,
                            workPerformed,
                            note: 'Completed via mobile terminal'
                          })}
                          style={{ flex: 1 }}
                          disabled={!findings.trim() || !workPerformed.trim()}
                        />
                        <Button
                          title="Cancel"
                          variant="secondary"
                          onPress={() => setCompletingOrderId(null)}
                          style={{ width: 80 }}
                        />
                      </View>
                    </View>
                  ) : (
                    <Button
                      title="Complete Work Order..."
                      variant="primary"
                      onPress={() => setCompletingOrderId(order._id)}
                      style={styles.orderActionBtn}
                    />
                  )
                )}
              </View>
            );
          })
        )}
      </Card>

      {/* Record Field Note */}
      {!isDecomm && (
        <Card title="Log Field Observation" subtitle="Record physical inspection findings to permanent machine history">
          {noteSuccess && (
            <View style={styles.noteSuccessBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="check" size={14} color="#16a34a" />
                <Text style={styles.noteSuccessText}>Field observation note logged to server.</Text>
              </View>
            </View>
          )}
          <TextInput
            style={[styles.textInput, { height: 72 }]}
            placeholder="e.g. Checked lube level; inspected sight glass; no abnormal rattle"
            placeholderTextColor="#64748b"
            value={noteContent}
            onChangeText={setNoteContent}
            multiline
          />
          <Button
            title="Submit Observation Note"
            variant="primary"
            loading={noteSubmitting}
            disabled={noteSubmitting || !noteContent.trim()}
            onPress={handleSubmitNote}
            style={{ marginTop: 8 }}
          />
        </Card>
      )}

      {/* Transmission Stages */}
      <Card title={`Mechanical Stages (${stages.length})`}>
        {stages.map((stg, i) => (
          <View key={stg.stage || i} style={styles.stageItem}>
            <View style={styles.stageHeader}>
              <Text style={styles.stageTitle}>Stage {stg.stage || i + 1}: {stg.type}</Text>
              <Text style={styles.stageRatio}>{stg.ratio}</Text>
            </View>
            {stg.conditionNotes && (
              <Text style={styles.stageCondition}>{stg.conditionNotes}</Text>
            )}
          </View>
        ))}
        <View style={styles.overallRatioBox}>
          <Text style={styles.overallLabel}>Overall Gearbox Ratio:</Text>
          <Text style={styles.overallVal}>{machine.gearRatio || '14.2:1'}</Text>
        </View>
      </Card>

      {/* Lubrication Specifications */}
      <Card title="Lubrication & Fluid Specs">
        <View style={styles.specRow}>
          <Text style={styles.specKey}>Oil Type:</Text>
          <Text style={styles.specValue}>{machine.lubrication?.oilType || machine.lubricantType || 'ISO VG 220 Synthetic'}</Text>
        </View>
        <View style={styles.specRow}>
          <Text style={styles.specKey}>Viscosity Grade:</Text>
          <Text style={styles.specValue}>{machine.lubrication?.isoVgGrade || 'ISO VG 220'}</Text>
        </View>
        <View style={styles.specRow}>
          <Text style={styles.specKey}>Rated Speed:</Text>
          <Text style={styles.specValue}>{machine.ratedSpeedRpm || 1780} RPM</Text>
        </View>
        <View style={styles.specRow}>
          <Text style={styles.specKey}>Rated Torque:</Text>
          <Text style={styles.specValue}>{machine.ratedTorqueNm || 480} Nm</Text>
        </View>
      </Card>

      {/* Monitored Sensor Channels */}
      <Card title={`Monitored Sensor Channels (${signals.length})`}>
        {signals.map((sig) => (
          <View key={sig.key} style={styles.signalRow}>
            <View style={styles.signalMain}>
              <Text style={styles.signalLabel}>{sig.label}</Text>
              <Text style={styles.signalKey}>{sig.key}</Text>
            </View>
            <View style={styles.signalMeta}>
              <View style={[styles.catBadge, sig.category === 'vibration' ? styles.catVib : sig.category === 'thermal' ? styles.catTherm : styles.catReg]}>
                <Text style={styles.catText}>{sig.category?.substring(0, 3).toUpperCase()}</Text>
              </View>
              <Text style={styles.unitText}>{sig.unit}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Action Buttons */}
      <View style={styles.actionGrid}>
        <Button
          title={`Upload Dataset for ${machineId}`}
          variant="primary"
          onPress={onNavigateUpload}
          disabled={isDecomm}
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
    backgroundColor: '#f6f5fb',
  },
  backBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  backBtnText: {
    color: '#7c3aed',
    fontSize: 13,
    fontWeight: '600',
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 4,
    shadowColor: '#1e1b4b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
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
    color: '#1e1b4b',
    fontFamily: 'monospace',
  },
  operationalBadge: {
    backgroundColor: '#f5f3ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  operationalBadgeText: {
    color: '#7c3aed',
    fontSize: 9,
    fontWeight: '800',
  },
  machineName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  subtext: {
    fontSize: 13,
    color: '#64748b',
  },
  locationText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  decommBanner: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  decommTitle: {
    color: '#b91c1c',
    fontWeight: '700',
    fontSize: 13,
  },
  decommDesc: {
    color: '#7f1d1d',
    fontSize: 11,
    lineHeight: 16,
  },
  emptyText: {
    fontSize: 12,
    color: '#64748b',
  },
  orderBox: {
    backgroundColor: '#ffffff',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
    marginBottom: 8,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderNumber: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#7c3aed',
  },
  orderBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  prioBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  prioHigh: {
    backgroundColor: '#fee2e2',
  },
  prioMed: {
    backgroundColor: '#fef3c7',
  },
  prioText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#1e1b4b',
  },
  statusBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#475569',
  },
  orderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  orderDesc: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  orderDue: {
    fontSize: 11,
    color: '#64748b',
  },
  feedbackBox: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
  },
  feedbackTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7c3aed',
  },
  feedbackText: {
    fontSize: 11,
    color: '#475569',
    marginTop: 2,
  },
  orderActionBtn: {
    marginTop: 6,
  },
  completionForm: {
    backgroundColor: '#f8fafc',
    borderColor: '#ede9f6',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#1e1b4b',
    minHeight: 48,
  },
  noteSuccessBox: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  noteSuccessText: {
    color: '#16a34a',
    fontSize: 11,
    fontWeight: '600',
  },
  stageItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ede9f6',
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
    color: '#1e1b4b',
  },
  stageRatio: {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#7c3aed',
  },
  stageCondition: {
    fontSize: 11,
    color: '#64748b',
  },
  overallRatioBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
  },
  overallLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  overallVal: {
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#7c3aed',
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#ede9f6',
  },
  specKey: {
    fontSize: 12,
    color: '#64748b',
  },
  specValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e1b4b',
  },
  signalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ede9f6',
  },
  signalMain: {
    flex: 1,
  },
  signalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e1b4b',
  },
  signalKey: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
    marginTop: 1,
  },
  signalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  catBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  catVib: {
    backgroundColor: '#e0f2fe',
  },
  catTherm: {
    backgroundColor: '#fef3c7',
  },
  catReg: {
    backgroundColor: '#f3e8ff',
  },
  catText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#1e1b4b',
  },
  unitText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
    minWidth: 40,
    textAlign: 'right',
  },
  actionGrid: {
    marginTop: 4,
  },
});
