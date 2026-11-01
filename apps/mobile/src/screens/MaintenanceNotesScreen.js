import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TextInput } from 'react-native';
import Card from '../components/Card.js';
import Button from '../components/Button.js';
import { DEMO_MAINTENANCE_NOTES, DEMO_MACHINES } from '@predictive-maintenance/shared';

export default function MaintenanceNotesScreen() {
  const [notes, setNotes] = useState(DEMO_MAINTENANCE_NOTES);
  const [selectedMachine, setSelectedMachine] = useState('GB-104');
  const [category, setCategory] = useState('Field Inspection');
  const [content, setContent] = useState('');
  const [successMsg, setSuccessMsg] = useState(false);

  const handleSave = () => {
    if (!content.trim()) return;

    const newNote = {
      id: `mnt-${Date.now()}`,
      machineId: selectedMachine,
      author: 'Alex Mercer (Lead Technician) [DEMO]',
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
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>FIELD LOGS</Text>
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
        </View>
        <Text style={styles.title}>Maintenance Notes</Text>
        <Text style={styles.subtitle}>
          Immutable record of field lubrication, seal inspections, and technician repairs.
        </Text>
      </View>

      {/* Log Form */}
      <Card title="Add Field Maintenance Log">
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
            {['Field Inspection', 'Lubrication', 'Sensor Calibration'].map((cat) => (
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
          <Text style={styles.successText}>✓ Maintenance note added to session log</Text>
        )}

        <Button
          title="Save Maintenance Note (Demo)"
          variant="primary"
          disabled={!content.trim()}
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
  formGroup: {
    gap: 6,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  chipBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  catBtn: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  textArea: {
    backgroundColor: '#090e1a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    color: '#f8fafc',
    fontSize: 13,
    minHeight: 75,
    textAlignVertical: 'top',
  },
  successText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  noteCard: {
    backgroundColor: '#131d33',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
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
    color: '#38bdf8',
  },
  noteTime: {
    fontSize: 10,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  noteMetaRow: {
    flexDirection: 'row',
    gap: 6,
  },
  machineTag: {
    backgroundColor: '#1a2744',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  machineTagText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  catTag: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  catTagText: {
    color: '#94a3b8',
    fontSize: 10,
  },
  noteBody: {
    fontSize: 12,
    color: '#f8fafc',
    lineHeight: 18,
    marginTop: 2,
  },
});

