import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import Icon from '../components/common/Icon.jsx';
import {
  USER_ROLES,
  WORK_ORDER_STATUS,
  WORK_ORDER_PRIORITY,
  OPERATIONAL_STATUS,
  MACHINE_TYPES,
  MACHINE_TYPE_LABELS,
  ALERT_STATUSES,
  ALERT_SEVERITIES
} from '@predictive-maintenance/shared';
import { useRouter, ROUTES } from '../router/Router.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Data-Driven Faults & Attack Scenarios Taxonomy
 * Grounded in the project's real physical benchmarks, vibration transducers, and Dyno Simulator perturbations.
 */
const SCENARIO_DEFINITIONS = [
  // 1. Excessive Vibration Excursions (Physical)
  {
    id: 'excessive_vibration',
    name: 'Excessive Vibration Excursion',
    subtitle: 'Radial & Axial Vibration Exceeding ISO 10816 Baseline',
    category: 'physical',
    domain: 'general_mechanical',
    targetComponent: 'Gearbox Housing & Bearings',
    signals: ['vibration_input_radial', 'vibration_output_radial', 'vibration_input_axial', 'vibration_rms'],
    description: 'Elevated structural vibration beyond statistical baseline (99.5th percentile threshold). Evaluated via unsupervised anomaly detection.',
    supportedBy: 'Isolation Forest Anomaly Detector, Rolling RMS Profiler',
    nominalCriteria: '< 4.5 mm/s RMS (ISO 10816-3 Class II Rigid Mount)',
    matchAlert: (alert) =>
      !alert.isSimulatorDerived &&
      (alert.triggeringPath === 'vibration_path' ||
        (alert.title || '').toLowerCase().includes('vibration') ||
        (alert.title || '').toLowerCase().includes('statistical anomaly') ||
        (alert.contributingSignals || []).some((s) => s.signal?.includes('vibration')))
  },
  // 2. Abnormal Temperature Rise & Thermal Friction (Physical)
  {
    id: 'abnormal_temperature',
    name: 'Abnormal Temperature Rise',
    subtitle: 'Sump Overheating & Boundary Lubrication Breakdown',
    category: 'physical',
    domain: 'general_mechanical',
    targetComponent: 'Sump Oil Reservoir & Mechanical Seals',
    signals: ['temp_gearbox_sump', 'temp_casing', 'oil_temperature'],
    description: 'Sump thermal elevation resulting from excessive gear mesh friction, oil breakdown, or low oil volume.',
    supportedBy: 'Thermal Transducer Path, ISO VG 220 Synthetic Thresholds',
    nominalCriteria: 'Steady-state < 65°C; Warning > 75°C; Trip > 90°C',
    matchAlert: (alert) =>
      !alert.isSimulatorDerived &&
      (alert.triggeringPath === 'thermal_path' ||
        (alert.contributingSignals || []).some((s) => s.signal?.includes('temp')))
  },
  // 3. Gear Mesh & Tooth Defect (Physical)
  {
    id: 'gear_tooth_fault',
    name: 'Gear Mesh & Tooth Defect',
    subtitle: 'Pinion/Wheel Tooth Chipping, Root Cracking & Severe Pitting',
    category: 'physical',
    domain: 'gear_faults',
    targetComponent: 'Reduction Stages 1-3 (Sun/Planet/Helical Gears)',
    signals: ['vibration_input_radial', 'vibration_output_radial', 'gmf_peak_energy'],
    description: 'Localized tooth surface damage causing periodic impacts at Gear Mesh Frequency (GMF) and sideband modulation.',
    supportedBy: 'SEU DDS Gearbox Benchmark, Random Forest Multi-Class Classifier',
    nominalCriteria: 'GMF sideband harmonics < 0.25 g peak; Kurtosis < 3.2',
    matchAlert: (alert) =>
      alert.targetDomain === 'gear_faults' ||
      (alert.title || '').toLowerCase().includes('gear') ||
      (alert.title || '').toLowerCase().includes('tooth') ||
      (alert.interval?.predictedClass || '').toLowerCase().includes('gear') ||
      (alert.interval?.predictedClass || '').toLowerCase().includes('tooth')
  },
  // 4. Bearing Degradation (Physical)
  {
    id: 'bearing_defect',
    name: 'Bearing Raceway & Element Defect',
    subtitle: 'Inner/Outer Ring Fatigue Spalling & Ball/Cage Wear',
    category: 'physical',
    domain: 'bearing_faults',
    targetComponent: 'Drive-End (DE) & Non-Drive-End (NDE) Bearings',
    signals: ['vibration_input_radial', 'vibration_input_axial', 'bearing_pass_frequencies'],
    description: 'Subsurface fatigue spalling on bearing raceways producing characteristic impact frequencies (BPFI, BPFO, BSF).',
    supportedBy: 'CWRU Bearing Benchmark, MFPT Benchmark Classifier',
    nominalCriteria: 'Crest factor < 4.0; Defect envelope energy < 0.15 g RMS',
    matchAlert: (alert) =>
      alert.targetDomain === 'bearing_faults' ||
      (alert.title || '').toLowerCase().includes('bearing') ||
      (alert.interval?.predictedClass || '').toLowerCase().includes('bearing') ||
      (alert.interval?.predictedClass || '').toLowerCase().includes('inner') ||
      (alert.interval?.predictedClass || '').toLowerCase().includes('outer')
  },
  // 5. Shaft Misalignment & Rotor Imbalance (Physical)
  {
    id: 'shaft_misalignment',
    name: 'Shaft Misalignment & Rotor Imbalance',
    subtitle: 'Angular/Parallel Coupling Offset & 1X/2X Shaft Harmonics',
    category: 'physical',
    domain: 'general_mechanical',
    targetComponent: 'Input Coupling & High-Speed Shaft',
    signals: ['rotational_speed', 'vibration_input_axial', 'vibration_input_radial'],
    description: 'Angular or parallel offset between drive motor and gearbox input shaft creating elevated 1X and 2X rotational speed vibration peaks.',
    supportedBy: 'Shaft Kinematic Harmonics, Multi-Regime Signal Decomposition',
    nominalCriteria: '2X/1X harmonic ratio < 0.50; Axial vibration < 2.8 mm/s',
    matchAlert: (alert) =>
      (alert.title || '').toLowerCase().includes('misalignment') ||
      (alert.title || '').toLowerCase().includes('imbalance') ||
      (alert.contributingSignals || []).some((s) => s.signal === 'rotational_speed' && s.deviationRatio > 1.3)
  },

  // 6. Clutch Slippage (Simulated Physical Fault)
  {
    id: 'sim_clutch_slippage',
    name: 'Clutch Slippage Fault Test',
    subtitle: 'Torque Transfer Capacity Drop & ΔRPM Divergence',
    category: 'simulated',
    simKey: 'clutch_slippage',
    attackType: 'SIMULATED FAULT',
    targetComponent: 'Clutch Friction Plate & Driven Hub',
    signals: ['gearbox_in_rpm', 'torque_nm', 'clutch_slip_rpm', 'clutch_temp'],
    description: 'Degrades maximum clutch clamping torque, creating speed divergence (ΔRPM) between crankshaft and input shaft while generating friction plate heat.',
    supportedBy: 'Transmission Dynamics Studio (100 Hz Numerical ODE)',
    nominalCriteria: 'Non-destructive physical ODE simulation strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('clutch_slippage') || (alert.title || '').toLowerCase().includes('clutch')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('clutch_slippage') || (ds.description || '').toLowerCase().includes('clutch'))
  },
  // 7. Gear Tooth Wear (Simulated Physical Fault)
  {
    id: 'sim_gear_tooth_wear',
    name: 'Gear Tooth Wear Fault Test',
    subtitle: 'Involute Pitting, Mesh Power Loss & GMF Harmonics',
    category: 'simulated',
    simKey: 'gear_tooth_wear',
    attackType: 'SIMULATED FAULT',
    targetComponent: 'Helical & Planetary Reduction Stages',
    signals: ['vib_rms', 'gearbox_out_rpm', 'temp_gearbox_sump'],
    description: 'Simulates progressive gear tooth surface pitting, exciting GMF vibration harmonics while preserving exact kinematic ratio (ω_out = ω_in / ratio).',
    supportedBy: 'Transmission Dynamics Studio (100 Hz Numerical ODE)',
    nominalCriteria: 'Non-destructive physical ODE simulation strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('gear_tooth_wear') || (alert.title || '').toLowerCase().includes('tooth wear')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('gear_tooth_wear') || (ds.description || '').toLowerCase().includes('tooth wear'))
  },
  // 8. Bearing Failure (Simulated Physical Fault)
  {
    id: 'sim_bearing_failure',
    name: 'Bearing Failure Fault Test',
    subtitle: 'Parasitic Drag Torque, Casing Heat & Raceway Spalling',
    category: 'simulated',
    simKey: 'bearing_failure',
    attackType: 'SIMULATED FAULT',
    targetComponent: 'Input/Output Shaft Support Bearings',
    signals: ['vib_rms', 'torque_nm', 'gearbox_in_rpm'],
    description: 'Increases Coulomb and viscous bearing friction drag, reducing shaft speed and delivered torque under load while elevating impact vibration.',
    supportedBy: 'Transmission Dynamics Studio (100 Hz Numerical ODE)',
    nominalCriteria: 'Non-destructive physical ODE simulation strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('bearing_failure') || (alert.title || '').toLowerCase().includes('bearing failure')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('bearing_failure') || (ds.description || '').toLowerCase().includes('bearing failure'))
  },
  // 9. Gearbox Lubrication Failure (Simulated Physical Fault)
  {
    id: 'sim_gearbox_lubrication_failure',
    name: 'Gearbox Lubrication Failure Test',
    subtitle: 'Boundary Film Breakdown, Sump Overheating & Scuffing',
    category: 'simulated',
    simKey: 'gearbox_lubrication_failure',
    attackType: 'SIMULATED FAULT',
    targetComponent: 'Sump Oil Reservoir & Hydrodynamic Film',
    signals: ['temp_gearbox_sump', 'vib_rms', 'coolant_c'],
    description: 'Collapses hydrodynamic film into severe boundary friction regime, causing sump oil temperature to surge (>95°C) and efficiency to collapse.',
    supportedBy: 'Transmission Dynamics Studio (100 Hz Numerical ODE)',
    nominalCriteria: 'Non-destructive physical ODE simulation strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('lubrication') || (alert.title || '').toLowerCase().includes('gearbox_lubrication')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('lubrication') || (ds.description || '').toLowerCase().includes('gearbox_lubrication'))
  },
  // 10. Engine Cooling Failure (Simulated Physical Fault)
  {
    id: 'sim_engine_cooling_failure',
    name: 'Engine Cooling Failure Test',
    subtitle: 'Radiator Throttling, Thermal Overheat & Torque Derating',
    category: 'simulated',
    simKey: 'engine_cooling_failure',
    attackType: 'SIMULATED FAULT',
    targetComponent: 'Radiator Convective Loop & Cylinder Head',
    signals: ['coolant_c', 'egt_c', 'torque_nm'],
    description: 'Restricts radiator heat dissipation, causing coolant to climb past 98°C, triggering electronic thermal derating and EGT elevation.',
    supportedBy: 'Transmission Dynamics Studio (100 Hz Numerical ODE)',
    nominalCriteria: 'Non-destructive physical ODE simulation strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('cooling') || (alert.title || '').toLowerCase().includes('engine_cooling')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('cooling') || (ds.description || '').toLowerCase().includes('engine_cooling'))
  },

  // 11. Vibration Harmonic Spike (Simulated Perturbation)
  {
    id: 'sim_vibration_spike',
    name: 'Vibration Harmonic Spike Attack',
    subtitle: 'High-Amplitude Resonance Perturbation (+4.0 mm/s)',
    category: 'simulated',
    simKey: 'vibration_spike',
    attackType: 'SIMULATED ATTACK',
    targetComponent: 'Vibration Transducer Telemetry',
    signals: ['vibration_rms', 'vibration_input_radial'],
    description: 'Synthetic high-amplitude harmonic spike perturbation injected in simulator memory to stress dynamic threshold tripping and classifier resistance.',
    supportedBy: 'Dyno Simulator Studio (Deterministic 100 Hz Engine)',
    nominalCriteria: 'Non-destructive synthetic test strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('vibration_spike') || (alert.title || '').toLowerCase().includes('spike')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('vibration_spike') || (ds.description || '').toLowerCase().includes('vibration_spike'))
  },
  // 7. Progressive Friction Drift (Simulated Perturbation)
  {
    id: 'sim_gradual_drift',
    name: 'Progressive Friction Drift Test',
    subtitle: 'Simulated Drag Accumulation (+0.2 mm/s/s) & Heat Escalation',
    category: 'simulated',
    simKey: 'gradual_drift',
    attackType: 'SIMULATED ATTACK',
    targetComponent: 'Transmission Gear Train & Thermal Path',
    signals: ['vibration_rms', 'temp_gearbox_sump', 'engine_temp'],
    description: 'Gradual increase in mechanical drag coefficient simulating progressive thermal runaway and boundary lubrication seizure.',
    supportedBy: 'Dyno Simulator Studio (Continuous Friction Perturbation)',
    nominalCriteria: 'Non-destructive synthetic test strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('gradual_drift') || (alert.title || '').toLowerCase().includes('drift')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('gradual_drift') || (ds.description || '').toLowerCase().includes('drift'))
  },
  // 8. Transducer Gaussian Noise (Simulated Attack)
  {
    id: 'sim_sensor_noise',
    name: 'Transducer Gaussian Noise Attack',
    subtitle: 'High-Entropy Sensor Jitter & Instrumentation Noise',
    category: 'simulated',
    simKey: 'sensor_noise',
    attackType: 'ATTACK TEST',
    targetComponent: 'Transducer ADC / Signal Conditioning',
    signals: ['vibration_input_radial', 'sensor_noise_floor'],
    description: 'High-variance Gaussian noise injected into transducer stream to evaluate model false-alarm immunity and filter rejection.',
    supportedBy: 'Dyno Simulator Studio (Gaussian White Noise Perturbation)',
    nominalCriteria: 'Non-destructive synthetic test strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('sensor_noise') || (alert.title || '').toLowerCase().includes('noise')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('sensor_noise') || (ds.description || '').toLowerCase().includes('noise'))
  },
  // 9. Transducer Latchup / Freeze (Simulated Attack)
  {
    id: 'sim_stuck_value',
    name: 'Transducer Latchup (Sensor Freeze)',
    subtitle: 'Data Tampering with Zero-Variance Constant Telemetry',
    category: 'simulated',
    simKey: 'stuck_value',
    attackType: 'ATTACK TEST',
    targetComponent: 'Transducer Serial Stream / Bus',
    signals: ['vibration_rms', 'telemetry_variance'],
    description: 'Repeated static reading injected into telemetry stream to test variance-collapse detection, timeout guards, and data sufficiency score.',
    supportedBy: 'Dyno Simulator Studio (Constant Value Latchup)',
    nominalCriteria: 'Non-destructive synthetic test strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('stuck_value') || (alert.title || '').toLowerCase().includes('latchup')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('stuck_value') || (ds.description || '').toLowerCase().includes('stuck'))
  },
  // 10. Telemetry Packet Dropout (Simulated Attack)
  {
    id: 'sim_missing_samples',
    name: 'Telemetry Packet Dropout Attack',
    subtitle: 'Network Frame Loss & Intermittent Data Omission',
    category: 'simulated',
    simKey: 'missing_samples',
    attackType: 'ATTACK TEST',
    targetComponent: 'Plant Gateway / Fieldbus Ingestion Pipe',
    signals: ['telemetry_frames', 'sample_continuity'],
    description: 'Simulated intermittent network loss dropping up to 20% of telemetry frames to test ML interpolation and data sufficiency checks.',
    supportedBy: 'Dyno Simulator Studio (Stochastic Dropout Perturbation)',
    nominalCriteria: 'Non-destructive synthetic test strictly inside browser memory',
    matchAlert: (alert) =>
      alert.isSimulatorDerived &&
      ((alert.title || '').toLowerCase().includes('missing_samples') || (alert.title || '').toLowerCase().includes('dropout')),
    matchDataset: (ds) =>
      ds.isSimulatorDerived &&
      ((ds.title || '').toLowerCase().includes('missing_samples') || (ds.description || '').toLowerCase().includes('dropout'))
  }
];

export default function MachineDetailPage() {
  const { params, queryParams, navigate } = useRouter();
  const { user } = useAuth();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;
  const isTechnician = user?.role === USER_ROLES.TECHNICIAN;
  const machineCode = params?.id || 'GB-104';

  const [machine, setMachine] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);
  const [machineDatasets, setMachineDatasets] = useState([]);
  const [machineAlerts, setMachineAlerts] = useState([]);
  const [machineAnalysisRuns, setMachineAnalysisRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [activeTab, setActiveTab] = useState(queryParams?.tab || 'kinematics');
  const [scenarioFilter, setScenarioFilter] = useState('all');

  // Maintenance note form
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('Field Inspection');
  const [noteSuccess, setNoteSuccess] = useState(null);
  const [noteError, setNoteError] = useState(null);

  // Work Order Modals
  const [showCreateOrderModal, setShowCreateOrderModal] = useState(false);
  const [showCompleteOrderModal, setShowCompleteOrderModal] = useState(null);
  const [showReviewOrderModal, setShowReviewOrderModal] = useState(null);
  const [showDecommissionModal, setShowDecommissionModal] = useState(false);
  const [decommissionReason, setDecommissionReason] = useState('');
  const [orderFormError, setOrderFormError] = useState(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  // New Work Order Form State
  const [newOrder, setNewOrder] = useState({
    title: '',
    description: '',
    priority: WORK_ORDER_PRIORITY.MEDIUM,
    dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split('T')[0],
    assignedTechnicianId: ''
  });

  // Technician Completion Feedback Form State
  const [completionFeedback, setCompletionFeedback] = useState({
    findings: '',
    workPerformed: '',
    followUpNeeded: '',
    note: ''
  });

  // Manager Review Notes Form State
  const [reviewNote, setReviewNote] = useState('');

  // Synchronize active tab from query parameters (e.g. #/machines/GB-104?tab=kinematics)
  useEffect(() => {
    if (queryParams?.tab) {
      setActiveTab(queryParams.tab);
    }
  }, [queryParams?.tab]);

  // Data-Driven Scenarios Processing: Connects to actual simulator runs, uploaded datasets, model runs, and alerts
  // Placed unconditionally at top level to strictly adhere to React Rules of Hooks
  const scenariosWithData = useMemo(() => {
    return SCENARIO_DEFINITIONS.map((sc) => {
      let matchedAlert = null;
      if (sc.category === 'simulated') {
        matchedAlert = (machineAlerts || []).find((a) => a.isSimulatorDerived && sc.matchAlert(a));
      } else {
        matchedAlert = (machineAlerts || []).find((a) => !a.isSimulatorDerived && sc.matchAlert(a));
      }

      const matchedRun = sc.category === 'simulated'
        ? (machineAnalysisRuns || []).find((r) => r.isSimulatorDerived && (r.datasetTitle || '').toLowerCase().includes(sc.simKey))
        : (machineAnalysisRuns || []).find((r) => !r.isSimulatorDerived && r.targetDomain === sc.domain);

      const matchedDataset = sc.category === 'simulated' && sc.matchDataset
        ? (machineDatasets || []).find((d) => d.isSimulatorDerived && sc.matchDataset(d))
        : null;

      let state = 'nominal';
      let stateLabel = 'Nominal · No Fault';
      let badgeClass = 'badge-healthy';

      if (matchedAlert) {
        if (matchedAlert.status === ALERT_STATUSES.OPEN) {
          state = 'active_alert';
          stateLabel = 'Active Alert Detected';
          badgeClass = matchedAlert.severity === ALERT_SEVERITIES.CRITICAL ? 'badge-critical' : 'badge-warning';
        } else if (matchedAlert.status === ALERT_STATUSES.ACKNOWLEDGED) {
          state = 'under_investigation';
          stateLabel = 'Under Investigation';
          badgeClass = 'badge-warning';
        } else if (matchedAlert.status === ALERT_STATUSES.RESOLVED) {
          state = 'resolved';
          stateLabel = 'Resolved / Mitigated';
          badgeClass = 'badge-healthy';
        }
      } else if (matchedDataset || matchedRun) {
        if (sc.category === 'simulated') {
          state = 'simulation_recorded';
          stateLabel = 'Simulation Recorded';
          badgeClass = 'scenario-badge-simulated';
        } else {
          state = 'analyzed';
          stateLabel = 'Analyzed · Within Baseline';
          badgeClass = 'badge-healthy';
        }
      } else if (sc.category === 'simulated') {
        state = 'not_executed';
        stateLabel = 'Ready in Simulator';
        badgeClass = 'badge-site';
      }

      return {
        ...sc,
        matchedAlert,
        matchedRun,
        matchedDataset,
        state,
        stateLabel,
        badgeClass,
        hasActiveEvidence: state === 'active_alert' || state === 'under_investigation',
        hasRecordedData: Boolean(matchedAlert || matchedRun || matchedDataset)
      };
    });
  }, [machineAlerts, machineAnalysisRuns, machineDatasets]);

  const activeScenariosCount = scenariosWithData.filter((s) => s.hasActiveEvidence).length;
  const simulatedRecordedCount = scenariosWithData.filter((s) => s.category === 'simulated' && s.hasRecordedData).length;

  const filteredScenarios = scenariosWithData.filter((s) => {
    if (scenarioFilter === 'physical') return s.category === 'physical';
    if (scenarioFilter === 'simulated') return s.category === 'simulated';
    if (scenarioFilter === 'active') return s.hasActiveEvidence;
    return true;
  });

  const fetchMachineAndOrders = useCallback(async () => {
    setLoading(true);
    setErrorStatus(null);
    setErrorMessage(null);

    try {
      // 1. Fetch machine profile
      const mRes = await fetch(`${API_BASE}/machines/${machineCode}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      const mData = await mRes.json();
      if (!mRes.ok) {
        setErrorStatus(mRes.status);
        setErrorMessage(mData.message || `HTTP ${mRes.status}: Access Denied`);
        setLoading(false);
        return;
      }

      setMachine(mData.machine);

      // Default assigned technician to first technician if available
      if (mData.machine.assignedTechnicians?.length > 0 && !newOrder.assignedTechnicianId) {
        setNewOrder((prev) => ({
          ...prev,
          assignedTechnicianId: mData.machine.assignedTechnicians[0]._id
        }));
      }

      // 2. Fetch work orders for this machine
      const woRes = await fetch(`${API_BASE}/machines/${machineCode}/work-orders`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (woRes.ok) {
        const woData = await woRes.json();
        setWorkOrders(woData.workOrders || []);
      }

      // 3. Fetch uploaded datasets for this machine
      const dsRes = await fetch(`${API_BASE}/datasets?machineId=${mData.machine._id}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (dsRes.ok) {
        const dsData = await dsRes.json();
        setMachineDatasets(dsData.datasets || []);
      }

      // 4. Fetch evidence alerts for this machine
      const alertRes = await fetch(`${API_BASE}/alerts?machineId=${mData.machine._id}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (alertRes.ok) {
        const alertData = await alertRes.json();
        setMachineAlerts(alertData.alerts || []);
      }

      // 5. Fetch verified analysis runs for this machine
      const arRes = await fetch(`${API_BASE}/analysis-runs?machineId=${mData.machine._id}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (arRes.ok) {
        const arData = await arRes.json();
        setMachineAnalysisRuns(arData.runs || []);
      }
    } catch (err) {
      setErrorStatus(500);
      setErrorMessage(err.message || 'Failed to connect to machine ledger API');
    } finally {
      setLoading(false);
    }
  }, [machineCode, newOrder.assignedTechnicianId]);

  useEffect(() => {
    fetchMachineAndOrders();
  }, [fetchMachineAndOrders]);

  // Handle Maintenance Note Logging
  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteContent.trim()) return;

    setNoteSuccess(null);
    setNoteError(null);

    try {
      const res = await fetch(`${API_BASE}/machines/${machineCode}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          content: noteContent.trim(),
          category: noteCategory
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setNoteError(data.message || `Server rejected note: ${res.status}`);
        return;
      }

      setNoteSuccess('Maintenance field note recorded in permanent machine ledger.');
      setNoteContent('');
      if (machine) {
        setMachine({
          ...machine,
          notes: [data.note, ...(machine.notes || [])]
        });
      }
    } catch (err) {
      setNoteError(err.message || 'Network error recording maintenance note.');
    }
  };

  // Handle Create Work Order
  const handleCreateWorkOrder = async (e) => {
    e.preventDefault();
    setOrderFormError(null);
    setOrderSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/machines/${machineCode}/work-orders`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(newOrder)
      });

      const data = await res.json();
      if (!res.ok) {
        setOrderFormError(data.message || `Failed to create work order: ${res.status}`);
        return;
      }

      setShowCreateOrderModal(false);
      setNewOrder({
        title: '',
        description: '',
        priority: WORK_ORDER_PRIORITY.MEDIUM,
        dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split('T')[0],
        assignedTechnicianId: machine.assignedTechnicians?.[0]?._id || ''
      });
      fetchMachineAndOrders();
    } catch (err) {
      setOrderFormError(err.message || 'Network error creating work order.');
    } finally {
      setOrderSubmitting(false);
    }
  };

  // Handle Status Update for Work Order
  const handleUpdateOrderStatus = async (orderId, targetStatus, extraPayload = {}) => {
    try {
      const res = await fetch(`${API_BASE}/work-orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          status: targetStatus,
          ...extraPayload
        })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.message || `Failed to update work order: ${res.status}`);
        return;
      }

      setShowCompleteOrderModal(null);
      setShowReviewOrderModal(null);
      fetchMachineAndOrders();
    } catch (err) {
      alert(`Network error updating work order: ${err.message}`);
    }
  };

  // Handle Soft-Decommissioning
  const handleDecommission = async () => {
    try {
      const res = await fetch(`${API_BASE}/machines/${machineCode}/decommission`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ reason: decommissionReason })
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.message || `Decommission failed: ${res.status}`);
        return;
      }

      setShowDecommissionModal(false);
      fetchMachineAndOrders();
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <p className="text-secondary">Loading gearbox engineering profile from plant database...</p>
      </div>
    );
  }

  // Scoped error display (403 Forbidden, 404 Not Found, or 500 Connection Failure)
  if (errorStatus) {
    const isNotFound = errorStatus === 404;
    const isForbidden = errorStatus === 403;

    return (
      <div className="page-container">
        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          <button className="breadcrumb-link" onClick={() => navigate(ROUTES.MACHINES)}>
            <Icon name="arrowLeft" size={13} style={{ marginRight: 4 }} />
            Machines Catalog
          </button>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{machineCode}</span>
        </nav>

        <Card
          title={
            isNotFound
              ? 'Machine Not Found in Factory Scope'
              : isForbidden
              ? 'Access Denied to Machine'
              : 'Machine Ledger Service Unavailable'
          }
          badge={<StatusBadge status={isNotFound ? 'critical' : 'warning'} label={`HTTP ${errorStatus}`} />}
        >
          <AlertCallout
            severity={isNotFound ? 'critical' : 'warning'}
            title={
              isNotFound
                ? '404 Scoped Boundary Isolation'
                : isForbidden
                ? '403 Unauthorized Equipment Assignment'
                : 'Connection or API Execution Failure'
            }
            description={
              isNotFound
                ? `Equipment "${machineCode}" does not exist within your factory scope (${user?.factoryId?.name || 'Factory'}). To prevent data leakage, cross-factory machine existence is never disclosed.`
                : isForbidden
                ? `Your account (${user?.fullName}, ${user?.role}) is not assigned to equipment "${machineCode}". Access is denied by backend middleware.`
                : (errorMessage || `Failed to retrieve equipment "${machineCode}" from the plant database. Please verify API server connectivity.`)
            }
            action={
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="secondary" onClick={() => navigate(ROUTES.MACHINES)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="arrowLeft" size={14} />
                  <span>Return to Accessible Machines</span>
                </Button>
                {!isNotFound && !isForbidden && (
                  <Button variant="primary" onClick={fetchMachineAndOrders}>
                    Retry Connection
                  </Button>
                )}
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  // Clear empty state when machine data record is unavailable (prevents blank screen)
  if (!machine) {
    return (
      <div className="page-container machine-detail-page">
        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          <button className="breadcrumb-link" onClick={() => navigate(ROUTES.MACHINES)}>
            <Icon name="arrowLeft" size={13} style={{ marginRight: 4 }} />
            Machines Catalog
          </button>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{machineCode}</span>
        </nav>

        <Card title={`Equipment Record Unavailable (${machineCode})`}>
          <AlertCallout
            severity="warning"
            title="Equipment Record Not Found"
            description={`No active equipment profile record was found for identifier "${machineCode}". The asset may be decommissioned, unassigned, or awaiting factory registry synchronization.`}
            action={
              <Button variant="secondary" onClick={() => navigate(ROUTES.MACHINES)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="arrowLeft" size={14} />
                <span>Return to Equipment Catalog</span>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const machineId = machine.code || machine.id;
  const isDecomm = machine.isDecommissioned || machine.operationalStatus === OPERATIONAL_STATUS.DECOMMISSIONED;
  const machineAlert = machineAlerts.find((a) => a.status === 'active' || a.status === 'acknowledged') || machineAlerts[0];
  const stages = machine.stages || [];
  const signals = machine.monitoredSignals || [];
  const notes = machine.notes || [];
  const assignedTechs = machine.assignedTechnicians || [];

  const latestDataset = machineDatasets.length > 0
    ? [...machineDatasets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    : null;
  const telemetryFreshness = latestDataset
    ? `Latest Ingestion: ${new Date(latestDataset.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : 'No Telemetry Uploaded Yet';

  return (
    <div className="page-container machine-detail-page">
      {/* Breadcrumb Navigation */}
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        <button className="breadcrumb-link" onClick={() => navigate(ROUTES.MACHINES)}>
          <Icon name="arrowLeft" size={13} style={{ marginRight: 4 }} />
          Machines Catalog
        </button>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{machineId}</span>
        <span className="breadcrumb-title-tag">({machine.name})</span>
      </nav>

      {/* Header Bar */}
      <div className="page-header machine-detail-header">
        <div className="machine-header-info">
          <div className="specimen-tag-row">
            <span className="mono-code machine-code-pill">{machineId}</span>
            <span className="badge badge-site">
              {MACHINE_TYPE_LABELS[machine.type] || machine.type || 'Equipment'}
            </span>
            <span className={`badge ${isDecomm ? 'badge-critical' : 'badge-healthy'}`}>
              {machine.operationalStatus?.toUpperCase() || 'OPERATIONAL'}
            </span>
            <StatusBadge
              status={machine.status}
              label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'}
              isSimulated={!machine._id}
            />
            <span
              className={`badge ${latestDataset ? 'badge-info' : 'badge-neutral'}`}
              title={latestDataset ? `Filename: ${latestDataset.originalFilename}` : undefined}
            >
              <Icon name="clock" size={11} style={{ marginRight: 4 }} />
              {telemetryFreshness}
            </span>
            <button
              type="button"
              className={`badge ${activeScenariosCount > 0 ? 'badge-warning' : 'badge-healthy'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setActiveTab('scenarios')}
              title="Jump to Faults & Attack Scenarios"
            >
              <Icon name="alert" size={11} style={{ marginRight: 4 }} />
              {activeScenariosCount > 0 ? `${activeScenariosCount} Active Faults` : 'Scenarios: Nominal'}
            </button>
            {simulatedRecordedCount > 0 && (
              <button
                type="button"
                className="badge scenario-badge-simulated"
                style={{ cursor: 'pointer' }}
                onClick={() => setActiveTab('scenarios')}
                title="Jump to Simulated Attack Tests"
              >
                <Icon name="activity" size={11} style={{ marginRight: 4 }} />
                {simulatedRecordedCount} Attack Tests
              </button>
            )}
          </div>
          <h1 className="page-title">{machine.name}</h1>
          <p className="page-subtitle">
            <span className="meta-item"><Icon name="cpu" size={13} /> {machine.manufacturer}</span>
            <span className="meta-sep">•</span>
            <span className="meta-item">Model {machine.model}</span>
            <span className="meta-sep">•</span>
            <span className="meta-item">Serial: <span className="mono-code">{machine.serialNumber || 'N/A'}</span></span>
            <span className="meta-sep">•</span>
            <span className="meta-item">Site: {machine.siteId?.name || machine.site || 'Plant Floor'}</span>
          </p>
        </div>

        <div className="page-header-actions">
          <Button
            variant="outline"
            onClick={() => {
              setActiveTab('kinematics');
              setTimeout(() => {
                const el = document.getElementById('kinematics-section');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 50);
            }}
            title="Inspect gearbox reduction architecture and kinematics"
            data-testid="inspect-kinematics-btn"
          >
            <Icon name="settings" size={14} style={{ marginRight: 6 }} />
            <span>Inspect Kinematics</span>
          </Button>

          {isManager && !isDecomm && (
            <Button
              variant="outline"
              onClick={() => setShowDecommissionModal(true)}
              style={{ color: '#dc2626', borderColor: 'rgba(239, 68, 68, 0.4)' }}
            >
              Decommission
            </Button>
          )}

          {isManager && (
            <Button
              variant="secondary"
              onClick={() => {
                setOrderFormError(null);
                setShowCreateOrderModal(true);
              }}
              disabled={isDecomm}
              title={isDecomm ? 'Cannot assign tasks to decommissioned machine' : 'Assign maintenance task'}
            >
              <Icon name="plus" size={14} style={{ marginRight: 6 }} /> Create Work Order
            </Button>
          )}

          <Button
            variant="primary"
            onClick={() => navigate(`${ROUTES.DATASETS_UPLOAD}?machineId=${machine._id || machineId}`)}
            disabled={isDecomm}
            title={isDecomm ? 'Cannot upload data for decommissioned machine' : 'Upload dataset'}
          >
            <Icon name="upload" size={14} style={{ marginRight: 6 }} /> Upload Telemetry
          </Button>
        </div>
      </div>

      {/* Decommission Banner if applicable */}
      {isDecomm && (
        <div style={{
          backgroundColor: '#fef2f2',
          borderColor: '#fecaca',
          borderWidth: 1,
          borderStyle: 'solid',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16
        }}>
          <h3 style={{ margin: 0, color: '#991b1b', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={16} color="#dc2626" /> Gearbox Specimen is Soft-Decommissioned
          </h3>
          <p style={{ margin: '4px 0 0', color: '#7f1d1d', fontSize: 13 }}>
            This gearbox has been taken out of active operational rotation. Historical kinematic records, past maintenance work orders, and field notes are preserved for auditing, but new operational dataset uploads and work orders are disallowed.
          </p>
          {machine.decommissionReason && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
              <strong>Decommission Reason:</strong> {machine.decommissionReason}
            </div>
          )}
        </div>
      )}

      {/* Active Warning Callout if present */}
      {machineAlert && (
        <AlertCallout
          severity={machineAlert.severity}
          title={`Active Warning: ${machineAlert.title}`}
          description={machineAlert.description}
          timestamp={
            machineAlert.createdAt || machineAlert.timestamp
              ? new Date(machineAlert.createdAt || machineAlert.timestamp).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : undefined
          }
          contributingSignals={machineAlert.contributingSignals}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(ROUTES.ALERTS)}
            >
              <span>Review Warnings Dashboard</span>
              <Icon name="arrowRight" size={13} style={{ marginLeft: 6 }} />
            </Button>
          }
        />
      )}

      {/* Detail Tabs */}
      <div className="tab-bar" role="tablist" aria-label="Machine Details Tabs">
        <button
          role="tab"
          aria-selected={activeTab === 'kinematics'}
          className={`tab-btn ${activeTab === 'kinematics' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('kinematics')}
          data-testid="kinematics-tab"
        >
          <Icon name="settings" size={14} style={{ marginRight: 6 }} />
          Kinematics & Lubrication
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'scenarios'}
          className={`tab-btn ${activeTab === 'scenarios' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('scenarios')}
        >
          <Icon name="shield" size={14} style={{ marginRight: 6 }} />
          Faults & Attack Scenarios {activeScenariosCount > 0 ? `(${activeScenariosCount} Active)` : ''}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'workorders'}
          className={`tab-btn ${activeTab === 'workorders' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('workorders')}
        >
          <Icon name="wrench" size={14} style={{ marginRight: 6 }} />
          Maintenance Tasks ({workOrders.length})
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'sensors'}
          className={`tab-btn ${activeTab === 'sensors' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('sensors')}
        >
          <Icon name="activity" size={14} style={{ marginRight: 6 }} />
          Sensor Channels ({signals.length})
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'notes'}
          className={`tab-btn ${activeTab === 'notes' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          <Icon name="edit" size={14} style={{ marginRight: 6 }} />
          Field Notes ({notes.length})
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'datasets'}
          className={`tab-btn ${activeTab === 'datasets' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('datasets')}
        >
          <Icon name="database" size={14} style={{ marginRight: 6 }} />
          Uploaded Datasets ({machineDatasets.length})
        </button>
      </div>

      {/* ================= TAB 1: Kinematics & Lubrication ================= */}
      {activeTab === 'kinematics' && (
        <div id="kinematics-section" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Kinematic Stages Breakdown */}
          <Card
            title={`Multi-Stage Reduction Architecture (${machine.arrangement || 'Helical-Planetary'})`}
            subtitle="Mechanical stage ratios, mesh parameters, and kinematic transmission stages"
            className="kinematics-stages-card"
          >
            {stages.length === 0 && (
              <div style={{
                padding: '16px 20px',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                marginBottom: 16
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13 }}>
                  <Icon name="info" size={16} color="#0f766e" />
                  <span>Direct Synchronous Drive Architecture</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  This equipment profile does not configure discrete intermediate gear stages. Drive kinetics follow nominal specifications: overall ratio {machine.gearRatio || '1:1'}, rated speed {machine.ratedSpeedRpm || 1780} RPM, rated load {machine.ratedTorqueNm || 480} Nm.
                </p>
              </div>
            )}

            <div className="stages-diagram-grid">
              {stages.map((stg) => (
                <div key={stg.stage} className="stage-diagram-card">
                  {/* Distinct stage label & title */}
                  <div className="stage-card-header">
                    <div className="stage-badge-pill">
                      <span className="stage-badge-indicator" />
                      STAGE {stg.stage}
                    </div>
                    <h3 className="stage-name-heading">{stg.type || `Reduction Stage ${stg.stage}`}</h3>
                  </div>

                  {/* Stage Ratio Field */}
                  <div className="stage-field-group">
                    <div className="stage-ratio-metric">
                      <span className="stage-field-label">Stage Ratio</span>
                      <span className="stage-ratio-value">{stg.ratio}</span>
                    </div>
                  </div>

                  {/* Gear Teeth Specs */}
                  {stg.teethPinion ? (
                    <div className="stage-teeth-row">
                      <span className="stage-teeth-label">Pinion / Gear Teeth:</span>
                      <span className="stage-teeth-value mono-code">
                        {stg.teethPinion}T Pinion · {stg.teethGear}T Wheel
                      </span>
                    </div>
                  ) : null}

                  {/* Condition Notes */}
                  <div className="stage-condition-row">
                    <span className="stage-field-label">Operating Condition</span>
                    <div className="stage-condition-chip">
                      <span className="stage-condition-dot" />
                      <span>{stg.conditionNotes || stg.condition || 'Nominal Condition'}</span>
                    </div>
                  </div>
                </div>
              ))}

              {/* Cumulative Kinematics (Total) */}
              <div className="stage-diagram-card overall-ratio-card">
                <div className="stage-card-header">
                  <div className="stage-badge-pill total-badge-pill">
                    <Icon name="activity" size={12} style={{ marginRight: 4 }} />
                    TOTAL
                  </div>
                  <h3 className="stage-name-heading total-heading">Cumulative Kinematics</h3>
                </div>

                <div className="stage-field-group">
                  <div className="stage-ratio-metric total-ratio-metric">
                    <span className="stage-field-label">Overall Ratio</span>
                    <span className="stage-ratio-value total-ratio-value">{machine.gearRatio || '14.2:1'}</span>
                  </div>
                </div>

                <div className="stage-rated-grid">
                  <div className="stage-rated-item">
                    <span className="stage-field-label">Rated Speed</span>
                    <span className="stage-rated-value mono-code">{machine.ratedSpeedRpm || 1780} RPM</span>
                  </div>
                  <div className="stage-rated-item">
                    <span className="stage-field-label">Rated Torque</span>
                    <span className="stage-rated-value mono-code">{machine.ratedTorqueNm || 480} Nm</span>
                  </div>
                </div>

                <div className="stage-condition-row">
                  <span className="stage-field-label">Kinematic Integrity</span>
                  <div className="stage-condition-chip total-chip">
                    <span className="stage-condition-dot total-dot" />
                    <span>Synchronous Drive · Continuous Mesh</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Bearings and Lubrication Specifications */}
          <div className="grid-two-col">
            <Card
              title="Bearing Positions & Enclosure Points"
              subtitle="Critical bearing support locations for vibration transducer placement"
            >
              {machine.bearingPositions && machine.bearingPositions.length > 0 ? (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Position</th>
                        <th scope="col">Bearing Type</th>
                        <th scope="col">Model Specification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {machine.bearingPositions.map((b, idx) => (
                        <tr key={idx}>
                          <td className="table-primary-text">{b.position}</td>
                          <td>{b.bearingType || 'Industrial Roller'}</td>
                          <td><span className="mono-code">{b.bearingModel || 'N/A'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-secondary">Standard drive-end (DE) and non-drive-end (NDE) bearing arrangement.</p>
              )}
            </Card>

            <Card
              title="Lubrication & Fluid Specifications"
              subtitle="Viscosity rating, sump volume, and manufacturer maintenance window"
            >
              <div className="kv-list">
                <div className="kv-item">
                  <span className="kv-key">Lubricant Oil Type</span>
                  <span className="kv-val">{machine.lubrication?.oilType || machine.lubricantType || 'ISO VG 220 Synthetic'}</span>
                </div>
                <div className="kv-item">
                  <span className="kv-key">ISO Viscosity Grade</span>
                  <span className="kv-val mono-code">{machine.lubrication?.isoVgGrade || 'ISO VG 220'}</span>
                </div>
                <div className="kv-item">
                  <span className="kv-key">Oil Sump Capacity</span>
                  <span className="kv-val">{machine.lubrication?.capacityLiters ? `${machine.lubrication.capacityLiters} L` : '18.5 Liters'}</span>
                </div>
                <div className="kv-item">
                  <span className="kv-key">Service Interval</span>
                  <span className="kv-val">{machine.lubrication?.serviceIntervalHours ? `${machine.lubrication.serviceIntervalHours} Operating Hours` : '4000 Hours'}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Assigned Technicians */}
          <Card
            title="Assigned Field Technicians"
            subtitle="Technicians authorized to log maintenance, inspect gear stages, and execute work orders on this machine"
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {assignedTechs.length > 0 ? (
                assignedTechs.map((t) => (
                  <div key={t._id || t} style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(15, 118, 110, 0.18)',
                    borderRadius: 8,
                    padding: '12px 16px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    minWidth: 220
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="user" size={14} color="#0f766e" /> {t.fullName || t.name || 'Technician'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                      {t.email} • <span className="badge badge-site" style={{ padding: '1px 6px', fontSize: 10 }}>{t.role?.toUpperCase()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-secondary">No technicians currently assigned. Only Factory Managers have access.</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ================= TAB: Faults & Attack Scenarios ================= */}
      {activeTab === 'scenarios' && (
        <div className="scenarios-container">
          {/* Header Summary Card */}
          <div className="scenarios-summary-card">
            <div className="scenarios-summary-text">
              <h2 className="scenarios-summary-title">
                <Icon name="shield" size={18} color="#0f766e" />
                Fault & Attack Defense Matrix
              </h2>
              <p className="scenarios-summary-desc">
                Data-driven correlation of live machine transducer signals, physical failure modes, and controlled synthetic attack perturbations. Grounded strictly in authorized factory records, model inference outputs, and simulator sessions.
              </p>
            </div>
            <div className="scenarios-metrics-pills">
              <div className="scenario-metric-badge">
                <span className="scenario-metric-label">Total Scenarios</span>
                <span className="scenario-metric-val">{scenariosWithData.length}</span>
              </div>
              <div className="scenario-metric-badge">
                <span className="scenario-metric-label">Active Alerts</span>
                <span className="scenario-metric-val" style={{ color: activeScenariosCount > 0 ? '#b45309' : '#059669' }}>
                  {activeScenariosCount}
                </span>
              </div>
              <div className="scenario-metric-badge">
                <span className="scenario-metric-label">Simulated Tests</span>
                <span className="scenario-metric-val" style={{ color: '#6d28d9' }}>
                  {simulatedRecordedCount}
                </span>
              </div>
            </div>
          </div>

          {/* Clean Baseline Empty State (When 0 active alerts & 0 attack runs exist) */}
          {activeScenariosCount === 0 && simulatedRecordedCount === 0 && (
            <div className="scenario-empty-banner">
              <div>
                <h3 className="scenario-empty-title">
                  <Icon name="check" size={18} color="#059669" />
                  Nominal Baseline — No Active Faults or Attack Telemetry Recorded
                </h3>
                <p className="scenario-empty-desc">
                  Equipment <strong>{machine.code}</strong> is currently operating within nominal baseline limits with zero active alert intervals or synthetic fault tests in the plant ledger. You can launch a controlled scenario in the simulator or upload a new telemetry dataset to evaluate pipeline detection.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate(`${ROUTES.SIMULATOR}?machine=${machine.code}`)}
                >
                  <Icon name="activity" size={13} style={{ marginRight: 6 }} />
                  Run Simulator Attack Scenario
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`${ROUTES.DATASETS_UPLOAD}?machineId=${machine._id || machineId}`)}
                >
                  <Icon name="upload" size={13} style={{ marginRight: 6 }} />
                  Upload Telemetry Dataset
                </Button>
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="scenarios-filter-bar">
            <div className="scenarios-filter-chips">
              <button
                type="button"
                className={`scenario-filter-chip ${scenarioFilter === 'all' ? 'scenario-filter-chip-active' : ''}`}
                onClick={() => setScenarioFilter('all')}
              >
                All Scenarios ({scenariosWithData.length})
              </button>
              <button
                type="button"
                className={`scenario-filter-chip ${scenarioFilter === 'physical' ? 'scenario-filter-chip-active' : ''}`}
                onClick={() => setScenarioFilter('physical')}
              >
                Physical Faults ({scenariosWithData.filter((s) => s.category === 'physical').length})
              </button>
              <button
                type="button"
                className={`scenario-filter-chip ${scenarioFilter === 'simulated' ? 'scenario-filter-chip-active' : ''}`}
                onClick={() => setScenarioFilter('simulated')}
              >
                Simulated & Attack Tests ({scenariosWithData.filter((s) => s.category === 'simulated').length})
              </button>
              <button
                type="button"
                className={`scenario-filter-chip ${scenarioFilter === 'active' ? 'scenario-filter-chip-active' : ''}`}
                onClick={() => setScenarioFilter('active')}
              >
                Active Detections Only ({activeScenariosCount})
              </button>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Showing {filteredScenarios.length} of {scenariosWithData.length} scenarios
            </div>
          </div>

          {/* Empty Filter State */}
          {filteredScenarios.length === 0 && (
            <Card>
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <Icon name="filter" size={24} color="#64748b" style={{ marginBottom: 8 }} />
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                  No scenarios matching filter "{scenarioFilter}"
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                  There are no scenarios currently matching this filter criteria for {machine.code}.
                </p>
                <Button size="sm" variant="secondary" onClick={() => setScenarioFilter('all')}>
                  Reset Filter
                </Button>
              </div>
            </Card>
          )}

          {/* Scenarios Grid */}
          <div className="scenarios-grid">
            {filteredScenarios.map((sc) => {
              const isSim = sc.category === 'simulated';
              const hasAlert = Boolean(sc.matchedAlert);
              const alert = sc.matchedAlert;
              const run = sc.matchedRun;
              const ds = sc.matchedDataset;

              return (
                <div
                  key={sc.id}
                  className={`scenario-card ${isSim ? 'scenario-simulated' : ''} ${
                    hasAlert && alert.severity === ALERT_SEVERITIES.CRITICAL
                      ? 'scenario-critical-alert'
                      : hasAlert
                      ? 'scenario-active-alert'
                      : ''
                  }`}
                >
                  {/* Card Header */}
                  <div className="scenario-card-header">
                    <div className="scenario-title-area">
                      <div className="scenario-category-row">
                        {isSim ? (
                          <span className="scenario-badge-simulated">
                            <Icon name="activity" size={10} />
                            {sc.attackType}
                          </span>
                        ) : (
                          <span className="scenario-badge-physical">
                            <Icon name="cpu" size={10} />
                            PHYSICAL MACHINE FAULT
                          </span>
                        )}
                        <span className={`badge ${sc.badgeClass}`}>
                          {sc.stateLabel}
                        </span>
                      </div>
                      <h3 className="scenario-name">{sc.name}</h3>
                      <p className="scenario-subtitle">{sc.subtitle}</p>
                    </div>

                    <StatusBadge
                      status={
                        hasAlert
                          ? alert.severity === ALERT_SEVERITIES.CRITICAL
                            ? 'critical'
                            : 'warning'
                          : isSim && sc.hasRecordedData
                          ? 'demo'
                          : 'healthy'
                      }
                      label={
                        hasAlert
                          ? alert.severity.toUpperCase()
                          : isSim && sc.hasRecordedData
                          ? 'SIMULATED'
                          : 'NOMINAL'
                      }
                    />
                  </div>

                  {/* Description */}
                  <p className="scenario-desc">{sc.description}</p>

                  {/* Technical Specifications */}
                  <div className="scenario-meta-table">
                    <div className="scenario-meta-row">
                      <span className="scenario-meta-key">Target Component:</span>
                      <span className="scenario-meta-val">{sc.targetComponent}</span>
                    </div>
                    <div className="scenario-meta-row">
                      <span className="scenario-meta-key">Detection Benchmark:</span>
                      <span className="scenario-meta-val">{sc.supportedBy}</span>
                    </div>
                    <div className="scenario-meta-row">
                      <span className="scenario-meta-key">Nominal Baseline Criteria:</span>
                      <span className="scenario-meta-val mono-code" style={{ fontSize: '0.7rem' }}>
                        {sc.nominalCriteria}
                      </span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span className="scenario-meta-key">Monitored Transducer Signals:</span>
                      <div className="scenario-signals-pills">
                        {sc.signals.map((sig) => (
                          <span key={sig} className="scenario-signal-pill mono-code">
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Grounded Evidence Box (Real Data Only!) */}
                  {hasAlert ? (
                    <div
                      className={`scenario-evidence-box ${
                        alert.severity === ALERT_SEVERITIES.CRITICAL ? 'evidence-critical' : 'evidence-alert'
                      }`}
                    >
                      <div className="scenario-evidence-header">
                        <span>
                          <Icon name="alert" size={11} style={{ marginRight: 4 }} />
                          {alert.isSimulatorDerived ? 'Simulated Alert Evidence' : 'Live Physical Evidence'}
                        </span>
                        <span className="mono-code">
                          {new Date(alert.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })}{' '}
                          {new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="scenario-evidence-content">
                        <strong>Alert:</strong> {alert.title}
                        {alert.fusionRationale && <div><em>Rationale:</em> {alert.fusionRationale}</div>}
                      </div>

                      {alert.contributingSignals && alert.contributingSignals.length > 0 && (
                        <div className="scenario-evidence-metric-row">
                          {alert.contributingSignals.slice(0, 3).map((cs, idx) => (
                            <div key={idx} className="scenario-evidence-metric">
                              <span className="scenario-evidence-metric-key">{cs.signal}</span>
                              <span className="scenario-evidence-metric-val">
                                {cs.peakValue ? Number(cs.peakValue).toFixed(2) : '—'} {cs.unit || ''}{' '}
                                {cs.deviationRatio ? `(+${Math.round((cs.deviationRatio - 1) * 100)}%)` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {alert.scores?.peakScore !== undefined && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: 12 }}>
                          <span>Peak Anomaly Score: <strong className="mono-code">{Number(alert.scores.peakScore).toFixed(3)}</strong></span>
                          <span>Threshold: <span className="mono-code">{Number(alert.scores.calibratedThreshold || 0.65).toFixed(3)}</span></span>
                        </div>
                      )}
                    </div>
                  ) : run ? (
                    <div className="scenario-evidence-box">
                      <div className="scenario-evidence-header">
                        <span>
                          <Icon name="analysis" size={11} style={{ marginRight: 4 }} />
                          Linked Analysis Run
                        </span>
                        <span className="mono-code">
                          {new Date(run.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                      <div className="scenario-evidence-content">
                        <strong>Model:</strong> {run.modelName} ({run.modelType})
                        <div>Anomalous Windows: <strong className="mono-code">{run.summary?.anomalousWindowsCount || 0}</strong></div>
                      </div>
                    </div>
                  ) : ds ? (
                    <div className="scenario-evidence-box">
                      <div className="scenario-evidence-header">
                        <span>
                          <Icon name="database" size={11} style={{ marginRight: 4 }} />
                          Simulated Telemetry Run Recorded
                        </span>
                        <span className="mono-code">
                          {new Date(ds.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                      <div className="scenario-evidence-content">
                        <strong>Dataset:</strong> {ds.title}
                        <div>Samples: <span className="mono-code">{ds.totalRows?.toLocaleString()} rows</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="scenario-evidence-box">
                      <div className="scenario-evidence-header">
                        <span>
                          <Icon name="check" size={11} style={{ marginRight: 4, color: '#059669' }} />
                          {isSim ? 'Simulation State' : 'Operational Condition'}
                        </span>
                        <span style={{ color: '#059669', fontWeight: 600 }}>Nominal</span>
                      </div>
                      <div className="scenario-evidence-content" style={{ color: 'var(--text-secondary)' }}>
                        {isSim
                          ? 'Scenario ready for non-destructive evaluation in Dyno Simulator Studio.'
                          : 'No active anomalous intervals detected. Live physical telemetry adheres to nominal baseline.'}
                      </div>
                    </div>
                  )}

                  {/* Card Action Footer */}
                  <div className="scenario-card-actions">
                    {isSim ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => navigate(`${ROUTES.SIMULATOR}?machine=${machine.code}&fault=${sc.simKey}`)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <Icon name="activity" size={12} />
                        <span>Launch in Simulator →</span>
                      </Button>
                    ) : (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Physical Machine Specimen: <strong className="mono-code">{machine.code}</strong>
                      </div>
                    )}

                    {hasAlert ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`${ROUTES.ALERTS}?machineId=${machine._id || machineId}`)}
                      >
                        View Alert Record →
                      </Button>
                    ) : run ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(ROUTES.ANALYSIS)}
                      >
                        View Analysis →
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= TAB 2: Maintenance Work Orders ================= */}
      {activeTab === 'workorders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Machine Work Order & Task Ledger
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Server-audited task assignment lifecycle: Open → Accepted → In Progress → Completed → Reviewed.
              </p>
            </div>
            {isManager && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setOrderFormError(null);
                  setShowCreateOrderModal(true);
                }}
                disabled={isDecomm}
              >
                + New Work Order
              </Button>
            )}
          </div>

          {workOrders.length === 0 ? (
            <Card title="No Work Orders Assigned">
              <p className="text-secondary">
                There are no open or past maintenance tasks recorded for this gearbox specimen.
              </p>
            </Card>
          ) : (
            workOrders.map((order) => {
              const isAssignedTech = order.assignedTechnicianId?._id === user?._id;
              const canProgress = isManager || isAssignedTech;

              return (
                <Card
                  key={order._id}
                  title={`[${order.orderNumber}] ${order.title}`}
                  subtitle={`Assigned to: ${order.assignedTechnicianId?.fullName || 'Technician'} • Created by: ${order.createdById?.fullName || 'Manager'}`}
                  badge={
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className={`badge ${
                        order.priority === 'urgent' || order.priority === 'high' ? 'badge-critical' : 'badge-info'
                      }`}>
                        {order.priority?.toUpperCase()} PRIORITY
                      </span>
                      <span className={`badge ${
                        order.status === WORK_ORDER_STATUS.REVIEWED ? 'badge-healthy' :
                        order.status === WORK_ORDER_STATUS.COMPLETED ? 'badge-info' :
                        order.status === WORK_ORDER_STATUS.IN_PROGRESS ? 'badge-warning' : 'badge-demo'
                      }`}>
                        {order.status?.toUpperCase()}
                      </span>
                    </div>
                  }
                  footer={
                    <div className="card-footer-split">
                      <span className="footer-meta">
                        Due: {new Date(order.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {order.completedAt && ` • Completed: ${new Date(order.completedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                        {order.reviewedAt && ` • Reviewed: ${new Date(order.reviewedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                      </span>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {canProgress && order.status === WORK_ORDER_STATUS.OPEN && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUpdateOrderStatus(order._id, WORK_ORDER_STATUS.ACCEPTED, { note: 'Work order accepted by technician' })}
                          >
                            Accept Task
                          </Button>
                        )}

                        {canProgress && (order.status === WORK_ORDER_STATUS.OPEN || order.status === WORK_ORDER_STATUS.ACCEPTED) && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleUpdateOrderStatus(order._id, WORK_ORDER_STATUS.IN_PROGRESS, { note: 'Commenced field inspection and disassembly' })}
                          >
                            Start Work
                          </Button>
                        )}

                        {canProgress && order.status === WORK_ORDER_STATUS.IN_PROGRESS && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setCompletionFeedback({ findings: '', workPerformed: '', followUpNeeded: '', note: '' });
                              setShowCompleteOrderModal(order);
                            }}
                          >
                            Complete Work Order
                          </Button>
                        )}

                        {isManager && order.status === WORK_ORDER_STATUS.COMPLETED && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setReviewNote('');
                              setShowReviewOrderModal(order);
                            }}
                          >
                            Review & Close (Manager)
                          </Button>
                        )}
                      </div>
                    </div>
                  }
                >
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 10px', lineHeight: 1.5 }}>
                    {order.description}
                  </p>

                  {/* Technician Feedback if completed */}
                  {order.technicianFeedback && (order.technicianFeedback.findings || order.technicianFeedback.workPerformed) && (
                    <div style={{
                      backgroundColor: '#f0fdf8',
                      border: '1px solid rgba(15, 118, 110, 0.2)',
                      borderRadius: 6,
                      padding: '10px 14px',
                      marginBottom: 10,
                      gap: 6
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#0f766e', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="edit" size={13} color="#0f766e" /> Technician Field Report:
                      </div>
                      {order.technicianFeedback.findings && (
                        <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                          <strong>Inspection Findings:</strong> {order.technicianFeedback.findings}
                        </div>
                      )}
                      {order.technicianFeedback.workPerformed && (
                        <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                          <strong>Work Performed:</strong> {order.technicianFeedback.workPerformed}
                        </div>
                      )}
                      {order.technicianFeedback.followUpNeeded && (
                        <div style={{ fontSize: 12, color: '#b45309' }}>
                          <strong>Follow-up Needed:</strong> {order.technicianFeedback.followUpNeeded}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manager Review Notes if reviewed */}
                  {order.reviewNotes && (
                    <div style={{
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: 6,
                      padding: '8px 12px',
                      marginBottom: 10,
                      fontSize: 12,
                      color: '#047857'
                    }}>
                      <strong>Manager Closure Review ({order.reviewedById?.fullName || 'Manager'}):</strong> {order.reviewNotes}
                    </div>
                  )}

                  {/* Audit Trail Timeline */}
                  <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Audit History:</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      {(order.statusHistory || []).map((h, i) => (
                        <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          • {new Date(h.timestamp).toLocaleTimeString()} ({new Date(h.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}):{' '}
                          <strong style={{ color: 'var(--text-primary)' }}>{h.status?.toUpperCase()}</strong> by {h.changedByName} ({h.changedByRole})
                          {h.note && ` — "${h.note}"`}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ================= TAB 3: Sensor Channels & Model Compatibility ================= */}
      {activeTab === 'sensors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            title="Supported Transducer Signals"
            subtitle="Configured physical channels, sampling intervals, and model feature pipelines"
          >
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Signal Name</th>
                    <th scope="col">Standard Unit</th>
                    <th scope="col">Sampling Interval</th>
                    <th scope="col">Transducer Channel Key</th>
                    <th scope="col">Used By Models</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((sig) => {
                    const interval = sig.category === 'vibration' ? '100 ms (10 Hz)' : sig.category === 'thermal' ? '1 s (1 Hz)' : '10 s';
                    const usedBy = sig.category === 'vibration' ? 'Random Forest (GB-104) & Isolation Forest' : sig.category === 'thermal' ? 'Thermal Anomaly Detector & Multi-Signal Fusion' : 'Regime Normalization';
                    return (
                      <tr key={sig.key}>
                        <td className="table-primary-text">{sig.label}</td>
                        <td><span className="mono-code">{sig.unit}</span></td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{interval}</span></td>
                        <td><span className="mono-code">{sig.key}</span></td>
                        <td>
                          <span className={`category-tag category-${sig.category}`}>
                            {usedBy}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Compatible Models & Domain Separation Notice (UX Pilot Page 1) */}
          <Card
            title="Compatible Predictive Models"
            subtitle="Validated AI model artifacts compatible with this machine type"
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>GB-104 Supervised Classifier</strong>
                  <span className="badge badge-healthy" style={{ fontSize: '0.68rem' }}>COMPATIBLE</span>
                </div>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Random Forest ensemble (100 estimators) trained on helical-planetary simulator telemetry. Predicts healthy vs tooth wear/chipping vs crack.
                </p>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                  Held-out Test Macro F1: 0.985 • Explainer: Exact TreeSHAP
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>Unsupervised Isolation Forest</strong>
                  <span className="badge badge-healthy" style={{ fontSize: '0.68rem' }}>COMPATIBLE</span>
                </div>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Unsupervised outlier scoring across vibration RMS, crest factor, and kurtosis. Calibrated threshold: 0.55.
                </p>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                  Outlier Contamination: 0.05 • Non-diagnostic statistical scoring
                </div>
              </div>
            </div>

            <div className="hero-limitation-box">
              <Icon name="shield" size={16} color="var(--primary)" />
              <div>
                <strong>Machine Domain Separation Notice:</strong>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem' }}>
                  CWRU Bearing Classifier (3 HP load split) and NASA IMS Bearing Degradation models are bearing-specific reference models. They are restricted to bearing experiments and <strong>cannot</strong> be run against gearbox assets.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ================= TAB 4: Field Notes & History ================= */}
      {activeTab === 'notes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Add Note Form */}
          {(isManager || isTechnician) && !isDecomm && (
            <Card title="Record Field Observation Note" subtitle="Submit physical findings or maintenance observations to this machine's permanent history">
              {noteSuccess && (
                <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: 10, borderRadius: 6, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={14} color="#16a34a" /> {noteSuccess}
                </div>
              )}
              {noteError && (
                <div className="login-error-alert" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="alert" size={14} color="#dc2626" />
                  <span>{noteError}</span>
                </div>
              )}
              <form onSubmit={handleAddNote} className="note-form">
                <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 220 }}>
                    <label className="form-label">Category:</label>
                    <select
                      className="form-select"
                      value={noteCategory}
                      onChange={(e) => setNoteCategory(e.target.value)}
                    >
                      <option value="Field Inspection">Field Inspection</option>
                      <option value="Lubrication">Lubrication Service</option>
                      <option value="Bearing Condition">Bearing Condition</option>
                      <option value="Acoustic Observation">Acoustic Observation</option>
                      <option value="Vibration Sensor Check">Sensor Check</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Observation Details:</label>
                    <input
                      type="text"
                      className="form-select"
                      placeholder="e.g. Replenished 250ml synthetic gear oil; inspected sight glass"
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <Button type="submit" variant="primary" size="sm">
                  Log Field Note
                </Button>
              </form>
            </Card>
          )}

          {/* Notes History */}
          <Card title="Permanent Maintenance History Log" subtitle="Audited event ledger recording commissioning, work orders, and field notes">
            {notes.length === 0 ? (
              <p className="text-secondary">No maintenance notes recorded yet for this gearbox.</p>
            ) : (
              <div className="notes-list">
                {notes.map((note, index) => (
                  <div key={note._id || index} className="note-item">
                    <div className="note-header">
                      <span className="note-author">{note.author}</span>
                      <span className="note-category badge badge-info">{note.category}</span>
                      <span className="note-time">{new Date(note.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="note-content">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ================= TAB 5: Uploaded Datasets ================= */}
      {activeTab === 'datasets' && (
        <Card
          title="Machine Ingested Datasets"
          subtitle="Historical raw and preprocessed operational datasets uploaded for this gearbox"
          badge={
            !isDecomm && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate(ROUTES.DATASETS_UPLOAD)}
              >
                + Ingest New Dataset
              </Button>
            )
          }
        >
          {machineDatasets.length === 0 ? (
            <p className="text-secondary text-sm">No datasets uploaded yet for this gearbox specimen.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Title & Filename</th>
                    <th scope="col">Modality</th>
                    <th scope="col">Observations</th>
                    <th scope="col">Sampling Rate</th>
                    <th scope="col">Quality Status</th>
                    <th scope="col">Uploaded By</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {machineDatasets.map((ds) => (
                    <tr key={ds._id}>
                      <td>
                        <div className="table-primary-text" style={{ fontWeight: 600 }}>{ds.title}</div>
                        <span className="mono-code text-muted" style={{ fontSize: '0.75rem' }}>{ds.originalFilename}</span>
                      </td>
                      <td>
                        <span className="badge badge-site">{ds.modality}</span>
                      </td>
                      <td><span className="mono-code">{ds.totalRows?.toLocaleString()}</span></td>
                      <td><span className="mono-code">{ds.samplingRateHz ? `${ds.samplingRateHz} Hz` : 'Snapshot'}</span></td>
                      <td>
                        <StatusBadge
                          status={ds.status === 'ready' ? 'healthy' : ds.status === 'needs_review' ? 'warning' : 'critical'}
                          label={ds.status.toUpperCase()}
                        />
                      </td>
                      <td>
                        <span className="text-sm">{ds.uploadedByName}</span>
                        <div className="text-muted" style={{ fontSize: '0.75rem' }}>{new Date(ds.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                      </td>
                      <td>
                        <a
                          href={`${API_BASE}/datasets/${ds._id}/download`}
                          download
                          className="btn btn-secondary btn-sm"
                          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Icon name="download" size={12} />
                          <span>Download CSV</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ================= MODAL: Create Work Order ================= */}
      {showCreateOrderModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h2 className="modal-title">Create Maintenance Work Order</h2>
              <button className="modal-close-btn" onClick={() => setShowCreateOrderModal(false)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            {orderFormError && (
              <div className="login-error-alert" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="alert" size={14} color="#dc2626" />
                <span>{orderFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateWorkOrder} className="modal-form">
              <div className="form-group">
                <label className="form-label">Work Order Title *</label>
                <input
                  type="text"
                  className="form-select"
                  placeholder="e.g. Inspect Planetary Stage Sun Pinion"
                  value={newOrder.title}
                  onChange={(e) => setNewOrder({ ...newOrder, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Task Description & Instructions *</label>
                <textarea
                  className="form-select"
                  rows={3}
                  placeholder="Specific inspection or repair instructions for the assigned technician"
                  value={newOrder.description}
                  onChange={(e) => setNewOrder({ ...newOrder, description: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Priority Level *</label>
                  <select
                    className="form-select"
                    value={newOrder.priority}
                    onChange={(e) => setNewOrder({ ...newOrder, priority: e.target.value })}
                  >
                    <option value={WORK_ORDER_PRIORITY.LOW}>Low</option>
                    <option value={WORK_ORDER_PRIORITY.MEDIUM}>Medium</option>
                    <option value={WORK_ORDER_PRIORITY.HIGH}>High</option>
                    <option value={WORK_ORDER_PRIORITY.URGENT}>Urgent</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Due Date *</label>
                  <input
                    type="date"
                    className="form-select"
                    value={newOrder.dueDate}
                    onChange={(e) => setNewOrder({ ...newOrder, dueDate: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assign Field Technician *</label>
                {assignedTechs.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="alert" size={14} color="#dc2626" /> No technicians are currently assigned to this machine. You must assign a technician to the machine before assigning work orders.
                  </p>
                ) : (
                  <select
                    className="form-select"
                    value={newOrder.assignedTechnicianId}
                    onChange={(e) => setNewOrder({ ...newOrder, assignedTechnicianId: e.target.value })}
                    required
                  >
                    {assignedTechs.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.fullName} ({t.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowCreateOrderModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={orderSubmitting} disabled={assignedTechs.length === 0}>
                  Issue Work Order
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: Complete Work Order ================= */}
      {showCompleteOrderModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h2 className="modal-title">Complete Work Order: {showCompleteOrderModal.orderNumber}</h2>
              <button className="modal-close-btn" onClick={() => setShowCompleteOrderModal(null)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateOrderStatus(showCompleteOrderModal._id, WORK_ORDER_STATUS.COMPLETED, completionFeedback);
            }} className="modal-form">
              <div className="form-group">
                <label className="form-label">Inspection Findings *</label>
                <textarea
                  className="form-select"
                  rows={2}
                  placeholder="Observed conditions (e.g. backlash, seal weeping, acoustic emission)"
                  value={completionFeedback.findings}
                  onChange={(e) => setCompletionFeedback({ ...completionFeedback, findings: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Work Performed *</label>
                <textarea
                  className="form-select"
                  rows={2}
                  placeholder="Actions taken (e.g. torqued bolts, replenished 250ml synthetic oil)"
                  value={completionFeedback.workPerformed}
                  onChange={(e) => setCompletionFeedback({ ...completionFeedback, workPerformed: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Follow-up Needed (Optional)</label>
                <input
                  type="text"
                  className="form-select"
                  placeholder="e.g. Order replacement labyrinth seal kit for next maintenance cycle"
                  value={completionFeedback.followUpNeeded}
                  onChange={(e) => setCompletionFeedback({ ...completionFeedback, followUpNeeded: e.target.value })}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowCompleteOrderModal(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Submit & Complete Work Order
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: Review Work Order (Manager) ================= */}
      {showReviewOrderModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2 className="modal-title">Manager Review & Closure</h2>
              <button className="modal-close-btn" onClick={() => setShowReviewOrderModal(null)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Final review for <strong>{showReviewOrderModal.orderNumber}</strong> ({showReviewOrderModal.title}). Review technician findings and close out work order.
            </p>

            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateOrderStatus(showReviewOrderModal._id, WORK_ORDER_STATUS.REVIEWED, { note: reviewNote });
            }} className="modal-form">
              <div className="form-group">
                <label className="form-label">Manager Review Notes</label>
                <textarea
                  className="form-select"
                  rows={3}
                  placeholder="e.g. Findings confirmed. Oil change logged in mechanical asset registry."
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowReviewOrderModal(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Confirm Review & Close Task
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: Decommission Machine ================= */}
      {showDecommissionModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#dc2626' }}>Soft-Decommission Gearbox</h2>
              <button className="modal-close-btn" onClick={() => setShowDecommissionModal(false)} aria-label="Close modal">
                <Icon name="close" size={16} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 12px' }}>
              Are you sure you want to soft-decommission <strong>{machineId} ({machine.name})</strong>?
              Historical telemetry and notes will remain intact, but this machine will be unavailable for new operational datasets or work orders.
            </p>

            <div className="form-group">
              <label className="form-label">Decommission Reason *</label>
              <textarea
                className="form-select"
                rows={3}
                placeholder="e.g. Replaced by high-efficiency planetary drive; archived for audit records"
                value={decommissionReason}
                onChange={(e) => setDecommissionReason(e.target.value)}
                required
              />
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <Button type="button" variant="secondary" onClick={() => setShowDecommissionModal(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleDecommission}
                disabled={!decommissionReason.trim()}
                style={{ backgroundColor: '#be123c', borderColor: '#9f1239' }}
              >
                Confirm Soft Decommission
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
