import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Card from '../components/Card.js';
import Button from '../components/Button.js';
import { DEMO_MAINTENANCE_NOTES, DEMO_MACHINES, WORK_ORDER_STATUS } from '@predictive-maintenance/shared';
import { useAuth } from '../context/AuthContext.js';
import { API_BASE } from '../services/apiConfig.js';

export default function MaintenanceNotesScreen() {
  const { token, user } = useAuth();
  const [notes, setNotes] = useState(DEMO_MAINTENANCE_NOTES);
  const [selectedMachine, setSelectedMachine] = useState('GB-104');
  const [category, setCategory] = useState('Field Inspection');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);

  // Assigned Work Orders
  const [myTasks, setMyTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!token) return;
    setLoadingTasks(true);
    try {
      const res = await fetch(`${API_BASE}/work-orders/my-tasks`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setMyTasks(data.workOrders || []);
      }
    } catch (err) {
      console.warn('[MaintenanceNotesScreen] Error loading tasks:', err.message);
    } finally {
      setLoadingTasks(false);
    }
  }, [token]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleSave = async () => {
    if (!content.trim()) return;

    if (!token) {
      // Local fallback
      const newNote = {
        id: `mnt-${Date.now()}`,
        machineId: selectedMachine,
        author: `${user?.fullName || 'Alex Mercer'} (Technician) [DEMO]`,
        timestamp: new Date().toLocaleTimeString() + ' (Today)',
        category,
        content: content.trim(),
        status: 'Recorded',
        isDemo: true
      };
      setNotes([newNote, ...notes]);
      setContent('');
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 3000);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/machines/${selectedMachine}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          content: content.trim(),
          category
        })
      });

      if (!res.ok) {
        const data = await res.json();
        Alert.alert('Error', data.message || 'Failed to submit maintenance note.');
        return;
      }

      const data = await res.json();
      const serverNote = {
        id: data.note?._id || `mnt-${Date.now()}`,
        machineId: selectedMachine,
        author: data.note?.author || `${user?.fullName} (${user?.role})`,
        timestamp: new Date().toLocaleTimeString() + ' (Just now)',
        category,
        content: content.trim(),
        status: 'Server Recorded',
        isDemo: false
      };

      setNotes([serverNote, ...notes]);
      setContent('');
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 3000);
    } catch (err) {
      Alert.alert('Network Error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTaskStatusUpdate = async (taskId, targetStatus) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/work-orders/${taskId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          status: targetStatus,
          note: `Technician transitioned task to ${targetStatus} via mobile terminal`
        })
      });

      if (!res.ok) {
        const data = await res.json();
        Alert.alert('Action Blocked', data.message || 'Failed to update task.');
        return;
      }

      loadTasks();
    } catch (err) {
      Alert.alert('Network Error', err.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>FIELD MAINTENANCE TERMINAL</Text>
          <View style={styles.scopeBadge}>
            <Text style={styles.scopeBadgeText}>
              {token ? 'BACKEND VERIFIED' : 'DEMO'}
            </Text>
          </View>
        </View>
        <Text style={styles.title}>Field Tasks & Notes</Text>
        <Text style={styles.subtitle}>
          Execute assigned maintenance work orders and log physical observations directly to machine history.
        </Text>
      </View>

      {/* Assigned Tasks Section */}
      <Card
        title={`My Assigned Work Orders (${myTasks.length})`}
        subtitle="Active work orders assigned to your technician account"
      >
        {loadingTasks ? (
          <ActivityIndicator size="small" color="#38bdf8" />
        ) : myTasks.length === 0 ? (
          <Text style={styles.emptyText}>
            No work orders currently assigned to you. Contact your plant manager for new work orders.
          </Text>
        ) : (
          myTasks.map((task) => (
            <View key={task._id} style={styles.taskCard}>
              <View style={styles.taskHeader}>
                <Text style={styles.taskNumber}>{task.orderNumber}</Text>
                <View style={[styles.prioBadge, task.priority === 'high' || task.priority === 'urgent' ? styles.prioHigh : styles.prioMed]}>
                  <Text style={styles.prioText}>{task.priority?.toUpperCase()}</Text>
                </View>
              </View>

              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.taskMachine}>
                Machine: {task.machineId?.code || 'GB-104'} ({task.machineId?.name || 'Gearbox'})
              </Text>
              <Text style={styles.taskDue}>Due Date: {new Date(task.dueDate).toLocaleDateString()}</Text>

              <View style={styles.taskActions}>
                {task.status === WORK_ORDER_STATUS.OPEN && (
                  <Button
                    title="Accept Work Order"
                    variant="secondary"
                    onPress={() => handleTaskStatusUpdate(task._id, WORK_ORDER_STATUS.ACCEPTED)}
                    style={styles.taskBtn}
                  />
                )}
                {(task.status === WORK_ORDER_STATUS.OPEN || task.status === WORK_ORDER_STATUS.ACCEPTED) && (
                  <Button
                    title="Start Work"
                    variant="primary"
                    onPress={() => handleTaskStatusUpdate(task._id, WORK_ORDER_STATUS.IN_PROGRESS)}
                    style={styles.taskBtn}
                  />
                )}
                {task.status === WORK_ORDER_STATUS.IN_PROGRESS && (
                  <View style={styles.inProgressNotice}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="clock" size={13} color="#7c3aed" />
                      <Text style={styles.inProgressText}>In Progress — View machine profile to complete</Text>
                    </View>
                  </View>
                )}
                {task.status === WORK_ORDER_STATUS.COMPLETED && (
                  <View style={styles.completedNotice}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="check" size={13} color="#16a34a" />
                      <Text style={styles.completedText}>Completed — Pending Manager Review</Text>
                    </View>
                  </View>
                )}
                {task.status === WORK_ORDER_STATUS.REVIEWED && (
                  <View style={styles.reviewedNotice}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="check" size={13} color="#15803d" />
                      <Text style={styles.reviewedText}>Reviewed & Closed by Manager</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </Card>

      {/* Log Form */}
      <Card title="Log Field Maintenance Observation">
        <View style={styles.formGroup}>
          <Text style={styles.label}>Target Machine:</Text>
          <View style={styles.chipRow}>
            {DEMO_MACHINES.map((m) => (
              <Button
                key={m.id}
                title={m.id}
                variant={selectedMachine === m.id ? 'primary' : 'secondary'}
                onPress={() => setSelectedMachine(m.id)}
                style={styles.chipBtn}
              />
            ))}
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Action Category:</Text>
          <View style={styles.chipRow}>
            {['Field Inspection', 'Lubrication', 'Sensor Calibration', 'Acoustic Check'].map((cat) => (
              <Button
                key={cat}
                title={cat}
                variant={category === cat ? 'primary' : 'secondary'}
                onPress={() => setCategory(cat)}
                style={styles.catBtn}
                textStyle={{ fontSize: 11 }}
              />
            ))}
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Technician Observations:</Text>
          <TextInput
            style={styles.textArea}
            multiline={true}
            numberOfLines={3}
            placeholder="Describe findings, grease type, measured clearances..."
            placeholderTextColor="#64748b"
            value={content}
            onChangeText={setContent}
          />
        </View>

        {successMsg && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 4 }}>
            <Feather name="check" size={13} color="#16a34a" />
            <Text style={styles.successText}>Maintenance observation recorded to machine ledger</Text>
          </View>
        )}

        <Button
          title={submitting ? 'Submitting...' : 'Save Maintenance Note'}
          variant="primary"
          disabled={!content.trim() || submitting}
          onPress={handleSave}
        />
      </Card>

      {/* Existing Notes Feed */}
      <Text style={styles.sectionHeader}>Historical Field Notes ({notes.length})</Text>

      {notes.map((note) => (
        <View key={note.id} style={styles.noteCard}>
          <View style={styles.noteTop}>
            <Text style={styles.noteAuthor}>{note.author}</Text>
            <Text style={styles.noteTime}>{note.timestamp}</Text>
          </View>
          <View style={styles.noteMetaRow}>
            <View style={styles.machineTag}>
              <Text style={styles.machineTagText}>{note.machineId}</Text>
            </View>
            <View style={styles.catTag}>
              <Text style={styles.catTagText}>{note.category}</Text>
            </View>
            <Text style={styles.statusPill}>{note.status}</Text>
          </View>
          <Text style={styles.noteBody}>{note.content}</Text>
        </View>
      ))}
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
  scopeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  scopeBadgeText: {
    color: '#34d399',
    fontSize: 8,
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
    lineHeight: 16,
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  taskCard: {
    backgroundColor: '#070b14',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    gap: 4,
    marginBottom: 8,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskNumber: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#38bdf8',
  },
  prioBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  prioHigh: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  prioMed: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  prioText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#f8fafc',
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  taskMachine: {
    fontSize: 11,
    color: '#38bdf8',
  },
  taskDue: {
    fontSize: 11,
    color: '#64748b',
  },
  taskActions: {
    marginTop: 6,
    gap: 6,
  },
  taskBtn: {
    minHeight: 38,
  },
  inProgressNotice: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 4,
    padding: 6,
  },
  inProgressText: {
    color: '#fcd34d',
    fontSize: 11,
    fontWeight: '600',
  },
  completedNotice: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: 4,
    padding: 6,
  },
  completedText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '600',
  },
  reviewedNotice: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 4,
    padding: 6,
  },
  reviewedText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '600',
  },
  formGroup: {
    marginBottom: 10,
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  chipBtn: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  catBtn: {
    minHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  textArea: {
    backgroundColor: '#070b14',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    color: '#f8fafc',
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  successText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noteCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  noteTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noteAuthor: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f8fafc',
  },
  noteTime: {
    fontSize: 11,
    color: '#64748b',
  },
  noteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  machineTag: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  machineTagText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#38bdf8',
  },
  catTag: {
    backgroundColor: 'rgba(2, 132, 199, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  catTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38bdf8',
  },
  statusPill: {
    fontSize: 10,
    color: '#94a3b8',
    marginLeft: 'auto',
  },
  noteBody: {
    fontSize: 12,
    color: '#cbd5e1',
    lineHeight: 18,
    marginTop: 2,
  },
});
