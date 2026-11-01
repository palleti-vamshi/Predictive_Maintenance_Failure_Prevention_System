import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import Card from '../components/Card.js';
import Button from '../components/Button.js';
import StatusBadge from '../components/StatusBadge.js';
import { useAuth } from '../context/AuthContext.js';
import {
  GEARBOX_SIGNALS,
  DATASET_TYPES,
  DATASET_STATUS,
  AI_TASK_TYPES
} from '@predictive-maintenance/shared';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:5001/api';

export default function UploadDatasetScreen() {
  const { sessionToken } = useAuth();

  const [assignedMachines, setAssignedMachines] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [loadingMachines, setLoadingMachines] = useState(true);

  // File picking & upload state
  const [pickedFile, setPickedFile] = useState(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedSession, setUploadedSession] = useState(null);

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  // Confirmation state
  const [confirming, setConfirming] = useState(false);
  const [confirmedDataset, setConfirmedDataset] = useState(null);

  // Fetch assigned machines for the technician
  useEffect(() => {
    async function fetchMachines() {
      try {
        setLoadingMachines(true);
        const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
        const res = await fetch(`${API_BASE}/machines`, { headers });
        if (res.ok) {
          const data = await res.json();
          const list = data.machines || [];
          setAssignedMachines(list);
          if (list.length > 0) {
            setSelectedMachineId(list[0]._id);
          }
        }
      } catch (err) {
        console.error('Failed to load assigned machines:', err);
      } finally {
        setLoadingMachines(false);
      }
    }
    fetchMachines();
  }, [sessionToken]);

  // Pick Document via Expo
  async function handlePickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const lowerName = file.name.toLowerCase();
        if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.txt')) {
          Alert.alert('Unsupported Format', 'Please select a standard CSV file (.csv or .txt).');
          return;
        }

        if (file.size && file.size > 25 * 1024 * 1024) {
          Alert.alert('File Too Large', 'Maximum accepted upload size is 25 MB.');
          return;
        }

        setPickedFile(file);
        setUploadedSession(null);
        setValidationResult(null);
        setConfirmedDataset(null);
        if (!title) {
          setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
        }
      }
    } catch (err) {
      console.error('Document picker error:', err);
      Alert.alert('File Picker Error', 'Could not open document picker.');
    }
  }

  // Upload file to server
  async function handleUploadAndParse() {
    if (!pickedFile) return;
    setUploading(true);

    try {
      const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
      const formData = new FormData();
      formData.append('file', {
        uri: pickedFile.uri,
        name: pickedFile.name,
        type: pickedFile.mimeType || 'text/csv'
      });

      const res = await fetch(`${API_BASE}/datasets/upload`, {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Upload failed');
      }

      setUploadedSession(data);

      // Auto-trigger initial validation with candidate mappings
      runValidation(data.uploadId, data.candidateMappings || []);
    } catch (err) {
      console.error('Upload error:', err);
      Alert.alert('Upload Failed', err.message || 'Could not upload dataset.');
    } finally {
      setUploading(false);
    }
  }

  // Run validation
  async function runValidation(uploadId, candidateMappings) {
    setValidating(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
      };

      const res = await fetch(`${API_BASE}/datasets/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uploadId,
          columnMappings: candidateMappings
        })
      });

      const data = await res.json();
      if (res.ok) {
        setValidationResult(data.validation);
      } else {
        throw new Error(data.message || 'Validation failed');
      }
    } catch (err) {
      console.error('Validation error:', err);
      Alert.alert('Validation Error', err.message || 'Could not validate dataset.');
    } finally {
      setValidating(false);
    }
  }

  // Confirm Ingestion
  async function handleConfirmIngestion() {
    if (!uploadedSession?.uploadId || !selectedMachineId || !title.trim()) {
      Alert.alert('Missing Details', 'Please enter a title and select a target machine.');
      return;
    }

    setConfirming(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
      };

      const res = await fetch(`${API_BASE}/datasets/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uploadId: uploadedSession.uploadId,
          datasetType: DATASET_TYPES.OPERATIONAL,
          title: title.trim(),
          machineId: selectedMachineId,
          columnMappings: uploadedSession.candidateMappings || []
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Ingestion confirmation failed');
      }

      setConfirmedDataset(data.dataset);
      Alert.alert('Success', 'Dataset successfully ingested and verified!');
    } catch (err) {
      console.error('Confirmation error:', err);
      Alert.alert('Ingestion Error', err.message || 'Failed to ingest dataset.');
    } finally {
      setConfirming(false);
    }
  }

  function handleReset() {
    setPickedFile(null);
    setUploadedSession(null);
    setValidationResult(null);
    setConfirmedDataset(null);
    setTitle('');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerBox}>
        <View style={styles.badgeRow}>
          <Text style={styles.headerLabel}>FIELD DATASET INGESTION</Text>
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>OPERATIONAL</Text>
          </View>
        </View>
        <Text style={styles.title}>Upload Machine Dataset</Text>
        <Text style={styles.subtitle}>
          Check in vibration & thermal CSV telemetry for assigned gearbox condition monitoring.
        </Text>
      </View>

      {confirmedDataset ? (
        <Card title="Ingestion Confirmed">
          <View style={styles.successBanner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Feather name="check" size={14} color="#16a34a" />
              <Text style={styles.successTitle}>{confirmedDataset.title}</Text>
            </View>
            <Text style={styles.successSub}>
              {confirmedDataset.totalRows} observations registered. Modality: {confirmedDataset.modality}.
            </Text>
          </View>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Status</Text>
              <Text style={styles.summaryVal}>{confirmedDataset.status?.toUpperCase()}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Sampling</Text>
              <Text style={styles.summaryVal}>
                {confirmedDataset.samplingRateHz ? `${confirmedDataset.samplingRateHz} Hz` : 'Snapshot'}
              </Text>
            </View>
          </View>

          <Button
            title="Upload Another Dataset"
            variant="secondary"
            onPress={handleReset}
          />
        </Card>
      ) : (
        <>
          {/* Target Equipment Selector */}
          <Card title="1. Select Assigned Machine">
            {loadingMachines ? (
              <ActivityIndicator color="#38bdf8" />
            ) : assignedMachines.length === 0 ? (
              <Text style={styles.emptyText}>No assigned machines found for your user.</Text>
            ) : (
              <View style={styles.selectorRow}>
                {assignedMachines.map((m) => {
                  const isSelected = m._id === selectedMachineId;
                  return (
                    <TouchableOpacity
                      key={m._id}
                      onPress={() => setSelectedMachineId(m._id)}
                      style={[styles.selectorBtn, isSelected && styles.selectorBtnActive]}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.selectorBtnText, isSelected && styles.selectorBtnTextActive]}>
                        {m.code}
                      </Text>
                      <Text style={styles.selectorSubtext} numberOfLines={1}>
                        {m.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={{ marginTop: 12 }}>
              <Text style={styles.inputLabel}>Dataset Run Title *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Oct 2026 Shift-1 Steady State"
                placeholderTextColor="#64748b"
                value={title}
                onChangeText={setTitle}
              />
            </View>
          </Card>

          {/* File Picker */}
          <Card title="2. Select CSV File from Device">
            <TouchableOpacity
              style={styles.dropzone}
              onPress={handlePickDocument}
              activeOpacity={0.7}
            >
              <Feather name="upload-cloud" size={36} color="#7c3aed" style={{ marginBottom: 6 }} />
              <Text style={styles.dropzoneTitle}>
                {pickedFile ? pickedFile.name : 'Tap to Choose CSV File'}
              </Text>
              <Text style={styles.dropzoneDesc}>
                {pickedFile
                  ? `${((pickedFile.size || 0) / 1024).toFixed(1)} KB • Tap to change`
                  : 'Accepted formats: .csv, .txt (Max 25 MB)'}
              </Text>
              <StatusBadge
                status={pickedFile ? 'healthy' : 'info'}
                label={pickedFile ? 'FILE SELECTED' : 'NO FILE'}
                style={{ marginTop: 6 }}
              />
            </TouchableOpacity>

            {pickedFile && !uploadedSession && (
              <Button
                title={uploading ? 'Uploading & Profiling...' : 'Upload & Inspect Headers'}
                variant="primary"
                disabled={uploading}
                onPress={handleUploadAndParse}
              />
            )}

            {uploadedSession && (
              <View style={styles.profileBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="check" size={13} color="#16a34a" />
                  <Text style={styles.profileTitle}>Headers & Delimiter Verified</Text>
                </View>
                <Text style={styles.profileText}>
                  {uploadedSession.totalRows} rows • {uploadedSession.totalColumns} cols • Delimiter: &apos;{uploadedSession.delimiter}&apos;
                </Text>
              </View>
            )}
          </Card>

          {/* Validation & AI Compatibility */}
          {validationResult && (
            <Card title="3. Quality & AI Compatibility Review">
              <View style={styles.qualitySummary}>
                <Text style={styles.qualityStatusTitle}>
                  Validation Outcome: {validationResult.status?.toUpperCase()}
                </Text>
                <Text style={styles.qualityModality}>
                  Modality: {validationResult.modality}
                </Text>
              </View>

              {/* Compatibility Tags */}
              <View style={styles.compatContainer}>
                <View style={styles.compatPill}>
                  <Text style={styles.compatName}>Anomaly Detection:</Text>
                  <Text style={[
                    styles.compatStatus,
                    validationResult.aiTaskCompatibility[AI_TASK_TYPES.ANOMALY_DETECTION]?.isCompatible
                      ? styles.compatYes
                      : styles.compatNo
                  ]}>
                    {validationResult.aiTaskCompatibility[AI_TASK_TYPES.ANOMALY_DETECTION]?.isCompatible ? 'COMPATIBLE' : 'NO'}
                  </Text>
                </View>

                <View style={styles.compatPill}>
                  <Text style={styles.compatName}>Fault Classification:</Text>
                  <Text style={[
                    styles.compatStatus,
                    validationResult.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION]?.isCompatible
                      ? styles.compatYes
                      : styles.compatNo
                  ]}>
                    {validationResult.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION]?.isCompatible ? 'COMPATIBLE' : 'NO'}
                  </Text>
                </View>

                <View style={styles.compatPill}>
                  <Text style={styles.compatName}>Remaining Useful Life:</Text>
                  <Text style={[
                    styles.compatStatus,
                    validationResult.aiTaskCompatibility[AI_TASK_TYPES.REMAINING_USEFUL_LIFE]?.isCompatible
                      ? styles.compatYes
                      : styles.compatNo
                  ]}>
                    {validationResult.aiTaskCompatibility[AI_TASK_TYPES.REMAINING_USEFUL_LIFE]?.isCompatible ? 'COMPATIBLE' : 'NO'}
                  </Text>
                </View>
              </View>

              <Button
                title={confirming ? 'Ingesting...' : 'Confirm Dataset Ingestion'}
                variant="primary"
                disabled={confirming || validationResult.status === DATASET_STATUS.REJECTED}
                onPress={handleConfirmIngestion}
              />
            </Card>
          )}
        </>
      )}
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
    backgroundColor: 'rgba(2, 132, 199, 0.25)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  demoBadgeText: {
    color: '#38bdf8',
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
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  selectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectorBtn: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 100,
    alignItems: 'center',
  },
  selectorBtnActive: {
    borderColor: '#0284c7',
    backgroundColor: 'rgba(2, 132, 199, 0.15)',
  },
  selectorBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  selectorBtnTextActive: {
    color: '#38bdf8',
  },
  selectorSubtext: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#cbd5e1',
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: '#090e1a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#f8fafc',
    fontSize: 13,
  },
  dropzone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#334155',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    gap: 4,
    marginBottom: 8,
  },
  dropzoneIcon: {
    fontSize: 28,
  },
  dropzoneTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  dropzoneDesc: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
  },
  profileBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
  },
  profileTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10b981',
  },
  profileText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  qualitySummary: {
    backgroundColor: '#090e1a',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 10,
  },
  qualityStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  qualityModality: {
    fontSize: 11,
    color: '#38bdf8',
    marginTop: 2,
  },
  compatContainer: {
    gap: 6,
    marginBottom: 12,
  },
  compatPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  compatName: {
    fontSize: 12,
    color: '#cbd5e1',
  },
  compatStatus: {
    fontSize: 11,
    fontWeight: '700',
  },
  compatYes: {
    color: '#10b981',
  },
  compatNo: {
    color: '#f43f5e',
  },
  successBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10b981',
  },
  successSub: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 2,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  summaryLabel: {
    fontSize: 10,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  summaryVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
    marginTop: 2,
  },
});
