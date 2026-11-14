import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter, ROUTES } from '../router/Router.jsx';
import Icon from '../components/common/Icon.jsx';
import SimulatorLiveGraph from '../components/simulator/SimulatorLiveGraph.jsx';
import SimulatorTimeline from '../components/simulator/SimulatorTimeline.jsx';
import {
  generateDemoSchedule,
  getScheduleSegmentAtTime,
  SUPPORTED_DEMO_FAULTS
} from '../components/simulator/demoScheduler.js';
import {
  extractWindowFeatures,
  evaluateIsolationForestAnomaly,
  classifyWithRandomForest,
  DemoAlertManager,
  evaluateRunPerformance
} from '../components/simulator/telemetryWindowing.js';
import {
  USER_ROLES,
  WORK_ORDER_PRIORITY
} from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * 5 Physical Fault Scenario Definitions Grounded in Manual Transmission Dynamics ODE
 */
export const FAULT_DEFINITIONS = [
  {
    id: 'clutch_slippage',
    name: 'Clutch slippage',
    component: 'Friction Plates & Driven Hub',
    subtitle: 'Torque Transfer Capacity Drop & ΔRPM Speed Divergence',
    defaultSeverity: 0.70,
    unit: '% wear / clamping loss',
    primaryEffects: 'Limits clamping torque capacity; causes engine RPM to diverge from gearbox input shaft (ΔRPM); dissipates slip friction heat into clutch plate.',
    secondaryEffects: 'Reduces net delivered torque; degrades mechanical efficiency; elevates slip chatter vibration.',
    unmodeledNotes: 'Micro-asperity boundary tribology and localized resin glazing are abstracted into numerical slip torque & thermal dissipation ODE.'
  },
  {
    id: 'gear_tooth_wear',
    name: 'Gear tooth wear',
    component: 'Helical Gear Train & Pinions',
    subtitle: 'Involute Surface Pitting & Harmonic Mesh Vibration',
    defaultSeverity: 0.65,
    unit: '% surface degradation',
    primaryEffects: 'Excites Gear Mesh Frequency (GMF) harmonic vibration and mesh power loss; degrades transmission mesh efficiency.',
    secondaryEffects: 'Elevates casing and sump oil temperature under sustained load. Crucially, output speed remains strictly governed by kinematic gear ratio (ω_out = ω_in / ratio).',
    unmodeledNotes: '3D tooth-root bending stress distribution and ultrasonic acoustic emission (>100 kHz) are outside 100 Hz kinematic ODE scope.'
  },
  {
    id: 'bearing_failure',
    name: 'Bearing failure',
    component: 'Countershaft Support Bearings',
    subtitle: 'Raceway Spalling, Parasitic Drag & Element Impacts',
    defaultSeverity: 0.60,
    unit: '% fatigue spalling',
    primaryEffects: 'Increases Coulomb and viscous parasitic drag torque; generates localized casing heat; elevates high-frequency raceway impact harmonics.',
    secondaryEffects: 'Shaft speed and delivered torque fall under load; mechanical transmission efficiency falls.',
    unmodeledNotes: 'Spectrometric oil wear debris particle concentration (ppm) and micro-crack acoustic emission are excluded from kinematic model.'
  },
  {
    id: 'gearbox_lubrication_failure',
    name: 'Gearbox lubrication failure',
    component: 'Sump Oil & Hydrodynamic Film',
    subtitle: 'Boundary Film Breakdown, Sump Overheating & Scuffing',
    defaultSeverity: 0.75,
    unit: '% film breakdown',
    primaryEffects: 'Severe loss of hydrodynamic lubricating film; heavy boundary friction on gear teeth and bearings; rapid climb in sump oil temperature (>95°C to 120°C).',
    secondaryEffects: 'Sharp drop in transmission efficiency (-24%); broadband scuffing and rubbing vibration; high parasitic drag.',
    unmodeledNotes: 'Dynamic oil viscosity shear curve and Total Acid Number (TAN) degradation are approximated via bulk thermal loss dissipation.'
  },
  {
    id: 'engine_cooling_failure',
    name: 'Engine cooling-system failure',
    component: 'Radiator Heat Exchanger & Water Pump',
    subtitle: 'Radiator Heat Removal Throttling, Overheat & Torque Derate',
    defaultSeverity: 0.80,
    unit: '% radiator restriction',
    primaryEffects: 'Reduces radiator heat dissipation capacity; coolant temperature escalates from 82°C past 98°C up to 110°C–125°C under load.',
    secondaryEffects: 'Increases Exhaust Gas Temperature (EGT); thermally derates available engine indicated torque above 98°C; penalizes fuel consumption (BSFC).',
    unmodeledNotes: 'Water pump impeller cavitation bubble dynamics are not modeled in lumped 1st-order thermal capacitance equations.'
  }
];

export default function SimulatorPage() {
  const { user } = useAuth();
  const { navigate, queryParams } = useRouter();

  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;

  const [machines, setMachines] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [technicians, setTechnicians] = useState([]);

  // Connection & Telemetry State
  const [connectionStatus, setConnectionStatus] = useState('waiting');
  const [simRunning, setSimRunning] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // ==========================================================================
  // AUTOMATIC DEMONSTRATION & REPRODUCIBLE SCHEDULER STATE
  // ==========================================================================
  const [selectedSeed, setSelectedSeed] = useState(42);
  const [totalDemoDuration, setTotalDemoDuration] = useState(60);
  const [demoState, setDemoState] = useState('stopped'); // 'stopped' | 'running' | 'paused' | 'completed'
  const [elapsedSimTime, setElapsedSimTime] = useState(0);

  // Generate deterministic schedule for selected seed & duration
  const schedule = useMemo(() => {
    return generateDemoSchedule({
      seed: selectedSeed,
      totalDuration: totalDemoDuration,
      healthyBaselineDuration: 10,
      recoveryDuration: 6
    });
  }, [selectedSeed, totalDemoDuration]);

  // Active schedule segment at current elapsed simulation time
  const activeSegment = useMemo(() => {
    return getScheduleSegmentAtTime(schedule.segments, elapsedSimTime);
  }, [schedule, elapsedSimTime]);

  // Rolling window predictions & persistent alert tracking
  const [modelPredictions, setModelPredictions] = useState([]);
  const [simulatedAlerts, setSimulatedAlerts] = useState([]);
  const [evaluationResult, setEvaluationResult] = useState(null);

  // Manual fallback controls toggle (collapsible)
  const [showManualControls, setShowManualControls] = useState(false);
  const [showReferenceGuide, setShowReferenceGuide] = useState(false);

  // 5 Physical Faults State (Manual Override)
  const [faultsState, setFaultsState] = useState({
    clutch_slippage: { enabled: false, severity: 0.70 },
    gear_tooth_wear: { enabled: false, severity: 0.65 },
    bearing_failure: { enabled: false, severity: 0.60 },
    gearbox_lubrication_failure: { enabled: false, severity: 0.75 },
    engine_cooling_failure: { enabled: false, severity: 0.80 }
  });
  const [activeFault, setActiveFault] = useState('none');
  const [faultSeverity, setFaultSeverity] = useState(0.85);

  // Live telemetry snapshot (null initially - NO placeholder readings!)
  const [liveSnapshot, setLiveSnapshot] = useState(null);

  // Session Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedSession, setRecordedSession] = useState(null);

  // Action & Analysis State
  const [actionLoading, setActionLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState(null);
  const [latestSavedDataset, setLatestSavedDataset] = useState(null);
  const [latestAnalysisResult, setLatestAnalysisResult] = useState(null);

  // Manager-Controlled Work Order Proposal Modal State
  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [proposalAlert, setProposalAlert] = useState(null);
  const [proposalForm, setProposalForm] = useState({
    machineCode: '',
    title: '',
    description: '',
    priority: WORK_ORDER_PRIORITY.HIGH,
    dueDate: '',
    assignedTechnicianId: ''
  });
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [proposalError, setProposalError] = useState(null);

  const iframeRef = useRef(null);
  const lastTickTimeRef = useRef(0);
  const lastTickWallTimeRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const recordingStartTimestampRef = useRef(0);

  // Windowing & Alert Manager references
  const alertManagerRef = useRef(new DemoAlertManager({ persistenceThreshold: 2, cooldownSeconds: 8 }));
  const sampleBufferRef = useRef([]);
  const healthyBaselineProfileRef = useRef(null);
  const activeFaultSegmentIdRef = useRef(null);
  const elapsedSimTimeRef = useRef(0);

  // Post command to simulator iframe with strict origin targeting
  const postToSimulator = useCallback((type, payload = {}) => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type, ...payload }, window.location.origin);
    }
  }, []);

  // Compute active fault list & healthy status for manual controls
  const activeFaultList = useMemo(() => {
    return Object.entries(faultsState)
      .filter(([_, v]) => v.enabled)
      .map(([k, v]) => ({
        id: k,
        name: FAULT_DEFINITIONS.find((d) => d.id === k)?.name || k,
        severity: v.severity
      }));
  }, [faultsState]);

  const isHealthyMode = activeFaultList.length === 0 && activeFault === 'none';

  // 1. Fetch authorized machines & technician roster
  useEffect(() => {
    let isMounted = true;
    async function fetchMachinesAndStaff() {
      try {
        setLoadingMachines(true);
        const res = await fetch(`${API_BASE}/machines`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          const machineList = data.machines || [];
          setMachines(machineList);
          if (machineList.length > 0) {
            const targetMachine = queryParams?.machine
              ? machineList.find((m) => m.code === queryParams.machine || m._id === queryParams.machine)
              : null;
            setSelectedMachineId(targetMachine ? targetMachine._id : machineList[0]._id);
          }
        }

        // Fetch technicians if manager
        if (isManager) {
          try {
            const uRes = await fetch(`${API_BASE}/admin/factory-users`, {
              credentials: 'include',
              headers: { Accept: 'application/json' }
            });
            if (uRes.ok && isMounted) {
              const uData = await uRes.json();
              const techs = (uData.users || []).filter((u) => u.role === USER_ROLES.TECHNICIAN);
              setTechnicians(techs);
            }
          } catch {
            // Non-critical
          }
        }
      } catch (err) {
        console.error('Failed to load machines:', err);
      } finally {
        if (isMounted) setLoadingMachines(false);
      }
    }
    fetchMachinesAndStaff();
    return () => {
      isMounted = false;
    };
  }, [queryParams?.machine, isManager]);

  // Selected machine code helper
  const selectedMachine = useMemo(() => {
    return machines.find((m) => m._id === selectedMachineId) || machines[0];
  }, [machines, selectedMachineId]);

  // 2. Telemetry Bridge: Listen to postMessage from embedded simulator iframe
  useEffect(() => {
    function handleMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'MECHGUARD_SIMULATOR_READY') {
        lastTickTimeRef.current = Date.now();
        setConnectionStatus('connected');
        return;
      }

      if (msg.type === 'MECHGUARD_TELEMETRY_TICK') {
        const now = Date.now();
        lastTickTimeRef.current = now;
        setConnectionStatus('connected');

        const snapshot = {
          simTime: Number.isFinite(msg.simTime) ? msg.simTime : 0,
          rpm: (typeof msg.rpm === 'number' && Number.isFinite(msg.rpm)) ? msg.rpm : null,
          inRpm: (typeof msg.inRpm === 'number' && Number.isFinite(msg.inRpm)) ? msg.inRpm : null,
          outRpm: (typeof msg.outRpm === 'number' && Number.isFinite(msg.outRpm)) ? msg.outRpm : null,
          genRpm: (typeof msg.genRpm === 'number' && Number.isFinite(msg.genRpm)) ? msg.genRpm : null,
          torque: (typeof msg.torque === 'number' && Number.isFinite(msg.torque)) ? msg.torque : null,
          powerKw: (typeof msg.powerKw === 'number' && Number.isFinite(msg.powerKw)) ? msg.powerKw : null,
          coolant: (typeof msg.coolant === 'number' && Number.isFinite(msg.coolant)) ? msg.coolant : null,
          egt: (typeof msg.egt === 'number' && Number.isFinite(msg.egt)) ? msg.egt : null,
          vibRms: (typeof msg.vibRms === 'number' && Number.isFinite(msg.vibRms)) ? msg.vibRms : null,
          clutchSlipRpm: Number.isFinite(msg.clutchSlipRpm) ? msg.clutchSlipRpm : 0,
          clutchTemp: Number.isFinite(msg.clutchTemp) ? msg.clutchTemp : 35.0,
          gearboxTemp: Number.isFinite(msg.gearboxTemp) ? msg.gearboxTemp : 52.0,
          transEffPct: Number.isFinite(msg.transEffPct) ? msg.transEffPct : 95.0,
          activeFaults: Array.isArray(msg.activeFaults) ? msg.activeFaults : [],
          isHealthy: msg.isHealthy !== undefined ? msg.isHealthy : true,
          operatingState: msg.operatingState || (msg.running ? 'RUNNING' : 'PAUSED'),
          currentGear: msg.currentGear !== undefined ? msg.currentGear : 3,
          targetGear: msg.targetGear !== undefined ? msg.targetGear : 3,
          shiftState: msg.shiftState || 'LOCKED',
          dataQuality: msg.dataQuality || 'nominal',
          bufferLength: Number.isFinite(msg.bufferLength) ? msg.bufferLength : 0
        };
        setLiveSnapshot(snapshot);
        if (typeof msg.running === 'boolean') {
          setSimRunning(msg.running);
        }

        // ====================================================================
        // AUTOMATIC DEMONSTRATION WORKFLOW LOOP
        // ====================================================================
        if (demoState === 'running') {
          // Compute elapsed simulation time step
          const dt = lastTickWallTimeRef.current > 0
            ? Math.min(0.25, (now - lastTickWallTimeRef.current) / 1000)
            : 0.1;
          lastTickWallTimeRef.current = now;

          const currentElapsed = elapsedSimTimeRef.current + dt;
          elapsedSimTimeRef.current = currentElapsed;
          setElapsedSimTime(currentElapsed);

          // Get active schedule segment at current simulation timestamp
          const currentSeg = getScheduleSegmentAtTime(schedule.segments, currentElapsed);

          // Trigger fault changes only when segment transitions
          if (currentSeg && currentSeg.id !== activeFaultSegmentIdRef.current) {
            activeFaultSegmentIdRef.current = currentSeg.id;
            if (currentSeg.isHealthy) {
              postToSimulator('MECHGUARD_RESET_HEALTHY');
              setActiveFault('none');
            } else {
              const faultPayload = {};
              SUPPORTED_DEMO_FAULTS.forEach((f) => {
                faultPayload[f.id] = f.id === currentSeg.faultId
                  ? { enabled: true, severity: currentSeg.severity }
                  : { enabled: false };
              });
              postToSimulator('MECHGUARD_SET_FAULTS', { faults: faultPayload });
              setActiveFault(currentSeg.faultId);
            }
          }

          // Accumulate raw telemetry into rolling sample buffer (zero ground-truth labels!)
          sampleBufferRef.current.push({
            ...snapshot,
            simTime: currentElapsed
          });
          if (sampleBufferRef.current.length > 200) {
            sampleBufferRef.current.shift();
          }

          // Rolling Window Inference: Form feature window once 16 samples exist, evaluated every 4 ticks
          if (sampleBufferRef.current.length >= 16 && sampleBufferRef.current.length % 4 === 0) {
            const windowSamples = sampleBufferRef.current.slice(-16);
            const features = extractWindowFeatures(windowSamples, 1.40);

            // Calibrate healthy baseline profile strictly during initial healthy baseline period
            if (currentElapsed < 9.5 || !healthyBaselineProfileRef.current) {
              healthyBaselineProfileRef.current = {
                meanVibRms: features.meanVibRms,
                meanClutchSlipRpm: features.meanClutchSlipRpm,
                meanTransEffPct: features.meanTransEffPct,
                gearboxTempRate: 0.05,
                coolantRate: 0.05,
                ratioError: 0.005
              };
            }

            // 1. Isolation Forest Anomaly Scoring (Baseline Outlier Distance, Not a Probability)
            const isoResult = evaluateIsolationForestAnomaly(features, healthyBaselineProfileRef.current);

            // 2. Random Forest Classifier (Domain-restricted to SEU DDS Gearbox Benchmark)
            const rfResult = classifyWithRandomForest(features, isoResult.isAnomaly);

            const predictionObj = {
              windowStartTime: features.windowStartTime,
              windowEndTime: features.windowEndTime,
              features,
              isolationForest: isoResult,
              randomForest: rfResult
            };

            setModelPredictions((prev) => [...prev.slice(-35), predictionObj]);

            // 3. Multi-Window Alert Persistence & Deduplication
            const targetCode = selectedMachine?.code || 'GB-104';
            const newAlert = alertManagerRef.current.processWindow(
              predictionObj,
              targetCode,
              `demo_seed_${schedule.seed}`
            );

            if (newAlert) {
              setSimulatedAlerts((prev) => [...prev, newAlert]);
            }
          }

          // Check for run completion
          if (currentElapsed >= totalDemoDuration) {
            setDemoState('completed');
            postToSimulator('MECHGUARD_RESET_HEALTHY');
            setActiveFault('none');

            // Evaluate end-of-run metrics
            const evalSummary = evaluateRunPerformance(
              schedule.faultEvents,
              alertManagerRef.current.alerts,
              totalDemoDuration
            );
            setEvaluationResult(evalSummary);
          }
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [demoState, schedule, totalDemoDuration, postToSimulator, selectedMachine]);

  // 3. Heartbeat monitor: marks disconnected if no telemetry ticks received within 2.5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastTickTimeRef.current === 0) {
        setConnectionStatus('waiting');
      } else if (Date.now() - lastTickTimeRef.current > 2500) {
        setConnectionStatus('disconnected');
      } else {
        setConnectionStatus('connected');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Clean up recording timer on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  // ==========================================================================
  // AUTOMATIC DEMONSTRATION CONTROLS (START / PAUSE / RESUME / RESET)
  // ==========================================================================
  const handleStartDemo = () => {
    // Reset transient buffers
    elapsedSimTimeRef.current = 0;
    setElapsedSimTime(0);
    activeFaultSegmentIdRef.current = null;
    sampleBufferRef.current = [];
    healthyBaselineProfileRef.current = null;
    alertManagerRef.current.reset();
    setModelPredictions([]);
    setSimulatedAlerts([]);
    setEvaluationResult(null);
    setActiveFault('none');

    // Start simulator engine & telemetry bridge together
    lastTickWallTimeRef.current = Date.now();
    postToSimulator('MECHGUARD_RESET_HEALTHY');
    postToSimulator('MECHGUARD_RESET');
    postToSimulator('MECHGUARD_SET_RUNNING', { running: true });
    setSimRunning(true);
    setDemoState('running');
  };

  const handlePauseDemo = () => {
    setDemoState('paused');
    postToSimulator('MECHGUARD_SET_RUNNING', { running: false });
    setSimRunning(false);
  };

  const handleResumeDemo = () => {
    lastTickWallTimeRef.current = Date.now();
    setDemoState('running');
    postToSimulator('MECHGUARD_SET_RUNNING', { running: true });
    setSimRunning(true);
  };

  const handleResetDemo = () => {
    setDemoState('stopped');
    elapsedSimTimeRef.current = 0;
    setElapsedSimTime(0);
    activeFaultSegmentIdRef.current = null;
    sampleBufferRef.current = [];
    healthyBaselineProfileRef.current = null;
    alertManagerRef.current.reset();
    setModelPredictions([]);
    setSimulatedAlerts([]);
    setEvaluationResult(null);
    setActiveFault('none');

    // Return simulator to clean healthy idle state
    postToSimulator('MECHGUARD_RESET_HEALTHY');
    postToSimulator('MECHGUARD_RESET');
    postToSimulator('MECHGUARD_SET_RUNNING', { running: true });
    setSimRunning(true);
  };

  const handleRandomizeSeed = () => {
    const nextSeed = Math.floor(Math.random() * 90000) + 1000;
    setSelectedSeed(nextSeed);
    if (demoState !== 'stopped') {
      handleResetDemo();
    }
  };

  const handleSeedChange = (val) => {
    const num = parseInt(val, 10);
    if (!Number.isNaN(num) && num >= 0) {
      setSelectedSeed(num);
      if (demoState !== 'stopped') {
        handleResetDemo();
      }
    }
  };

  // ==========================================================================
  // MANAGER WORK ORDER PROPOSAL MODAL (NO AUTO-CREATION)
  // ==========================================================================
  const handleOpenWorkOrderProposal = (alert) => {
    setProposalAlert(alert);
    const targetCode = alert.machineCode || selectedMachine?.code || 'GB-104';
    const defaultTech = technicians[0]?._id || '';

    setProposalForm({
      machineCode: targetCode,
      title: `[SIMULATED REMEDIATION] Investigate ${alert.modelDiagnosis || 'Kinematic Anomaly'} on ${targetCode}`,
      description: `Dispatched from automated simulator test run (Seed #${schedule.seed}).\nObserved Evidence:\n${alert.evidence?.map((e) => `• ${e}`).join('\n') || '• Significant baseline deviation'}\n\nEvaluating Models: ${alert.modelsUsed?.join(', ')}\nAnomaly Score: ${alert.anomalyScore} / 1.0 (${alert.scoreInterpretation})\n\nNOTE: Physical on-site inspection required before clearing maintenance record.`,
      priority: alert.severity === 'critical' ? WORK_ORDER_PRIORITY.CRITICAL : WORK_ORDER_PRIORITY.HIGH,
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      assignedTechnicianId: defaultTech
    });
    setProposalError(null);
    setIsProposalModalOpen(true);
  };

  const handleSubmitWorkOrderProposal = async (e) => {
    e.preventDefault();
    if (!proposalForm.machineCode || !proposalForm.title || !proposalForm.assignedTechnicianId) {
      setProposalError('Please specify target machine, task title, and assign an authorized technician.');
      return;
    }

    try {
      setIsSubmittingProposal(true);
      setProposalError(null);

      const res = await fetch(`${API_BASE}/machines/${proposalForm.machineCode}/work-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(proposalForm)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to dispatch work order.');
      }

      setIsProposalModalOpen(false);
      setActionStatus({
        type: 'success',
        title: 'Work Order Dispatched by Manager',
        message: `Work Order [${data.workOrder?.orderNumber || 'Created'}] successfully created and assigned to authorized field technician.`
      });
    } catch (err) {
      console.error('Work order proposal error:', err);
      setProposalError(err.message || 'Server error creating work order.');
    } finally {
      setIsSubmittingProposal(false);
    }
  };

  // Helper to fetch CSV from simulator iframe
  const requestCsvFromSimulator = () => {
    return new Promise((resolve, reject) => {
      const reqId = `csv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('Timed out waiting for simulator telemetry log.'));
      }, 5000);

      function onMessage(event) {
        if (event.data?.type === 'MECHGUARD_CSV_RESPONSE' && event.data?.requestId === reqId) {
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(event.data);
        }
      }

      window.addEventListener('message', onMessage);
      postToSimulator('MECHGUARD_GET_CSV', { requestId: reqId });
    });
  };

  // Save Run as Dataset Action (runAnalysis: false)
  const handleSaveRunAsDataset = async () => {
    if (!selectedMachineId) {
      setActionStatus({
        type: 'error',
        title: 'Machine Selection Required',
        message: 'Please select a monitored factory machine to associate with this simulated dataset.'
      });
      return;
    }

    try {
      setActionLoading(true);
      setActionStatus({
        type: 'info',
        title: 'Extracting Telemetry Buffer...',
        message: 'Extracting 15-channel simulation buffer from virtual digital twin...'
      });

      const csvData = await requestCsvFromSimulator();
      if (!csvData || !csvData.csv || (csvData.rowsCount || 0) < 5) {
        throw new Error('Simulation buffer is warming up. Please allow the simulation to run before saving.');
      }

      const machineCode = selectedMachine?.code || 'GB-104';
      const faultSummary = `Automated Demo Run (Seed #${schedule.seed}) — ${schedule.faultEvents.length} Simulated Fault Events`;

      const payload = {
        machineId: selectedMachineId,
        title: `[SIMULATED] ${machineCode} Dyno Test — Seed #${schedule.seed}`,
        description: `15-channel deterministic powertrain simulation. Duration: ${csvData.durationSeconds?.toFixed(1) || '?'}s, Samples: ${csvData.rowsCount}. ${faultSummary}`,
        telemetry: csvData.csv,
        faultMetadata: {
          seed: schedule.seed,
          isSimulated: true,
          provenance: '[SIMULATED]',
          scheduledFaults: schedule.faultEvents.map((f) => ({
            faultId: f.faultId,
            faultName: f.faultName,
            severity: f.severity,
            startTime: f.startTime,
            endTime: f.endTime
          }))
        },
        runAnalysis: false
      };

      const res = await fetch(`${API_BASE}/datasets/simulator-ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Dataset ingestion failed');
      }

      setLatestSavedDataset(data.dataset);
      setActionStatus({
        type: 'success',
        title: 'Run Saved as Verified Simulated Dataset',
        message: `Dataset "${data.dataset.title}" created with ID ${data.dataset._id}. Stored ${data.diagnostics?.totalRows || csvData.rowsCount} samples tagged with [SIMULATED] label.`
      });
    } catch (err) {
      console.error('Save dataset error:', err);
      setActionStatus({
        type: 'error',
        title: 'Failed to Save Dataset',
        message: err.message || 'Network or validation error occurred.'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csvData = await requestCsvFromSimulator();
      if (!csvData?.csv) throw new Error('No telemetry data available for export.');
      const blob = new Blob([csvData.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simulated_telemetry_seed_${schedule.seed}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  };

  // Manual fallback controls
  const handleFaultToggle = (faultId, enabled) => {
    setFaultsState((prev) => {
      const updated = {
        ...prev,
        [faultId]: { ...prev[faultId], enabled }
      };
      postToSimulator('MECHGUARD_SET_FAULTS', { faults: updated });
      return updated;
    });
  };

  const handleFaultSeverityChange = (faultId, severity) => {
    setFaultsState((prev) => {
      const updated = {
        ...prev,
        [faultId]: { ...prev[faultId], severity: Number(severity) }
      };
      postToSimulator('MECHGUARD_SET_FAULTS', { faults: updated });
      return updated;
    });
  };

  return (
    <div className="simulator-page" style={{ padding: '1.25rem 1.5rem', maxWidth: '1440px', margin: '0 auto' }}>
      {/* 1. Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-teal, #0f766e)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Digital Twin & Simulation
            </span>
            <span
              className="badge"
              style={{
                backgroundColor: 'rgba(217, 119, 6, 0.15)',
                color: '#D97706',
                border: '1px solid rgba(217, 119, 6, 0.35)',
                fontSize: '0.7rem',
                fontWeight: 700
              }}
            >
              SIMULATED TELEMETRY ONLY
            </span>

            {/* Live Connection Badge */}
            {connectionStatus === 'connected' && (
              <span className="badge" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.35)', fontSize: '0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#059669', display: 'inline-block' }} />
                CONNECTED (10 Hz BRIDGE)
              </span>
            )}
            {connectionStatus === 'waiting' && (
              <span className="badge" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#D97706', border: '1px solid rgba(245, 158, 11, 0.35)', fontSize: '0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#D97706', display: 'inline-block' }} />
                CONNECTING BRIDGE...
              </span>
            )}
            {connectionStatus === 'disconnected' && (
              <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#DC2626', border: '1px solid rgba(239, 68, 68, 0.35)', fontSize: '0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#DC2626', display: 'inline-block' }} />
                FEED DISCONNECTED
              </span>
            )}
          </div>

          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Automated Gearbox Fault & Detection Demonstration
          </h1>
          <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Scheduled physical anomaly injection, rolling feature windowing, and truthful ML classification. Strict browser simulation with zero connection to physical controls.
          </p>
        </div>

        {/* Machine Target Selector & CSV Uploader Link */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate(ROUTES.DATASETS)}
            className="btn btn-sm"
            style={{
              background: '#FFFFFF',
              color: '#334155',
              border: '1px solid #CBD5E1',
              padding: '0.45rem 0.8rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
            title="Upload standard CSV datasets or benchmark recordings"
          >
            <span>Open CSV Dataset Uploader</span>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>↗</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#FFFFFF', padding: '0.45rem 0.8rem', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Monitored Machine Target
              </label>
              <select
                id="simulatorMachineSelect"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.82rem', fontWeight: 600, borderRadius: '4px', border: '1px solid #CBD5E1', color: 'var(--text-primary)', background: '#F8FAFC' }}
                value={selectedMachineId}
                onChange={(e) => setSelectedMachineId(e.target.value)}
                disabled={loadingMachines || machines.length === 0}
              >
                {machines.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.code} — {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 2. AUTOMATIC DEMONSTRATION CONTROL CONSOLE */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '10px',
          padding: '1.25rem',
          border: '1px solid #E2E8F0',
          marginBottom: '1.25rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}
      >
        {/* Top Action Bar: Run State, Controls & Seed Input */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Left: Master Run State Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.35rem 0.85rem',
                borderRadius: '20px',
                fontSize: '0.78rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                background:
                  demoState === 'running'
                    ? '#ecfdf5'
                    : demoState === 'paused'
                    ? '#eff6ff'
                    : demoState === 'completed'
                    ? '#f0fdf4'
                    : '#f8fafc',
                color:
                  demoState === 'running'
                    ? '#047857'
                    : demoState === 'paused'
                    ? '#1d4ed8'
                    : demoState === 'completed'
                    ? '#15803d'
                    : '#475569',
                border:
                  demoState === 'running'
                    ? '1.5px solid #10b981'
                    : demoState === 'paused'
                    ? '1.5px solid #3b82f6'
                    : demoState === 'completed'
                    ? '1.5px solid #22c55e'
                    : '1px solid #cbd5e1'
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background:
                    demoState === 'running'
                      ? '#10b981'
                      : demoState === 'paused'
                      ? '#3b82f6'
                      : demoState === 'completed'
                      ? '#22c55e'
                      : '#94a3b8'
                }}
              />
              {demoState === 'running' && 'DEMO RUNNING (LIVE INFERENCE)'}
              {demoState === 'paused' && 'DEMO PAUSED (PHYSICS FROZEN)'}
              {demoState === 'completed' && 'DEMO COMPLETED (EVALUATION READY)'}
              {demoState === 'stopped' && 'DEMO READY (HEALTHY BASELINE)'}
            </span>

            {/* Quick Action Controls */}
            {demoState === 'stopped' && (
              <button
                data-testid="demo-start-btn"
                onClick={handleStartDemo}
                style={{
                  background: 'linear-gradient(135deg, #0f766e, #047857)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.5rem 1.1rem',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 2px 4px rgba(15, 118, 110, 0.25)'
                }}
              >
                <span>▶ Start Demonstration Run</span>
              </button>
            )}

            {demoState === 'running' && (
              <button
                data-testid="demo-pause-btn"
                onClick={handlePauseDemo}
                style={{
                  background: '#1e293b',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.5rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <span>❚❚ Pause Run</span>
              </button>
            )}

            {demoState === 'paused' && (
              <button
                data-testid="demo-resume-btn"
                onClick={handleResumeDemo}
                style={{
                  background: '#047857',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.5rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <span>▶ Resume Run</span>
              </button>
            )}

            {demoState !== 'stopped' && (
              <button
                data-testid="demo-reset-btn"
                onClick={handleResetDemo}
                style={{
                  background: '#f8fafc',
                  color: '#dc2626',
                  border: '1px solid #fca5a5',
                  borderRadius: '6px',
                  padding: '0.5rem 0.85rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Reset to Baseline
              </button>
            )}

            {demoState === 'completed' && (
              <button
                onClick={handleStartDemo}
                style={{
                  background: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.5rem 1rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Replay Scenario
              </button>
            )}
          </div>

          {/* Right: Reproducible Random Seed Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#f8fafc', padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>
                Scenario Seed:
              </label>
              <input
                data-testid="demo-seed-input"
                type="number"
                value={selectedSeed}
                onChange={(e) => handleSeedChange(e.target.value)}
                disabled={demoState === 'running'}
                style={{
                  width: '70px',
                  padding: '0.2rem 0.4rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1'
                }}
              />
              <button
                type="button"
                onClick={handleRandomizeSeed}
                disabled={demoState === 'running'}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  padding: '0.2rem 0.5rem',
                  fontSize: '0.7rem',
                  cursor: demoState === 'running' ? 'not-allowed' : 'pointer'
                }}
                title="Generate new pseudo-random demonstration scenario"
              >
                🎲 Randomize
              </button>
            </div>

            {/* Duration Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f8fafc', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Duration:</span>
              {[45, 60, 90].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => {
                    setTotalDemoDuration(sec);
                    if (demoState !== 'stopped') handleResetDemo();
                  }}
                  disabled={demoState === 'running'}
                  style={{
                    background: totalDemoDuration === sec ? '#0f766e' : '#ffffff',
                    color: totalDemoDuration === sec ? '#ffffff' : '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    padding: '0.15rem 0.4rem',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: demoState === 'running' ? 'not-allowed' : 'pointer'
                  }}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Real-time Status KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
          {/* Progress Card */}
          <div style={{ background: '#F8FAFC', borderRadius: '6px', padding: '0.75rem', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                Demonstration Progress
              </span>
              <strong style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: '#0F172A' }}>
                {elapsedSimTime.toFixed(1)}s / {totalDemoDuration}s
              </strong>
            </div>
            {/* Progress Bar */}
            <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, (elapsedSimTime / totalDemoDuration) * 100)}%`,
                  height: '100%',
                  background: demoState === 'running' ? '#0f766e' : demoState === 'completed' ? '#22c55e' : '#94a3b8',
                  transition: 'width 0.15s ease'
                }}
              />
            </div>
          </div>

          {/* Active Injected Scenario [GROUND TRUTH] */}
          <div style={{ background: '#F8FAFC', borderRadius: '6px', padding: '0.75rem', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                Active Injected Scenario
              </span>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '1px 4px', borderRadius: '3px' }}>
                GROUND TRUTH
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: activeSegment?.isHealthy ? '#047857' : '#b45309' }}>
              {activeSegment?.faultName || 'Healthy Baseline'}
              {!activeSegment?.isHealthy && activeSegment?.severity ? ` (${Math.round(activeSegment.severity * 100)}% Severity)` : ''}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeSegment?.subsystem || 'Nominal operating baseline'}
            </div>
          </div>

          {/* Rolling Window Inference [MODEL] */}
          <div style={{ background: '#F8FAFC', borderRadius: '6px', padding: '0.75rem', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                Latest Model Inference
              </span>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#ede9fe', color: '#6b21a8', padding: '1px 4px', borderRadius: '3px' }}>
                TELEMETRY ONLY
              </span>
            </div>
            {modelPredictions.length > 0 ? (
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: modelPredictions[modelPredictions.length - 1].isolationForest.isAnomaly ? '#991b1b' : '#047857' }}>
                  {modelPredictions[modelPredictions.length - 1].randomForest.label}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.15rem' }}>
                  Anomaly Score: <strong>{modelPredictions[modelPredictions.length - 1].isolationForest.anomalyScore}</strong> (Outlier distance)
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
                Accumulating 16-sample telemetry window...
              </div>
            )}
          </div>

          {/* Persistent Alerts Count */}
          <div style={{ background: '#F8FAFC', borderRadius: '6px', padding: '0.75rem', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                Verified Simulated Alerts
              </span>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '1px 4px', borderRadius: '3px' }}>
                K=2 PERSISTENCE
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: simulatedAlerts.length > 0 ? '#b91c1c' : '#047857' }}>
              {simulatedAlerts.length} Alert{simulatedAlerts.length === 1 ? '' : 's'} Triggered
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.15rem' }}>
              Deduplicated by run, machine &amp; interval
            </div>
          </div>
        </div>
      </div>

      {/* 3. MULTI-TRACK INTERACTIVE TIMELINE */}
      <div style={{ marginBottom: '1.25rem' }}>
        <SimulatorTimeline
          schedule={schedule}
          currentTime={elapsedSimTime}
          totalDuration={totalDemoDuration}
          modelPredictions={modelPredictions}
          alerts={simulatedAlerts}
        />
      </div>

      {/* 4. PERSISTENT SIMULATED CONDITION ALERTS FEED */}
      {simulatedAlerts.length > 0 && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: '8px',
            padding: '1.1rem',
            border: '1.5px solid #fecaca',
            marginBottom: '1.25rem',
            boxShadow: '0 2px 4px rgba(220, 38, 38, 0.04)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icon name="alert" size={18} color="#dc2626" />
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#991b1b' }}>
                Simulated Condition Alerts Feed ({simulatedAlerts.length})
              </span>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px' }}>
                [SIMULATED]
              </span>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
              Hysteresis &amp; Cooldown Enforced · No permanent work orders auto-created
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {simulatedAlerts.map((alert) => (
              <div
                key={alert.id}
                data-testid="simulated-alert-card"
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '6px',
                  padding: '0.85rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}
              >
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        background: alert.severity === 'critical' ? '#dc2626' : '#d97706',
                        color: '#ffffff',
                        padding: '1px 5px',
                        borderRadius: '3px'
                      }}
                    >
                      {alert.severity.toUpperCase()}
                    </span>
                    <strong style={{ fontSize: '0.85rem', color: '#1e293b' }}>
                      {alert.title}
                    </strong>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                      Window: {alert.windowRange}
                    </span>
                  </div>

                  {/* Telemetry Evidence */}
                  <div style={{ fontSize: '0.75rem', color: '#334155', marginBottom: '0.35rem' }}>
                    <strong>Telemetry Evidence:</strong>{' '}
                    {alert.evidence?.join(' • ') || 'Multiple physical channel deviations observed.'}
                  </div>

                  {/* Model Diagnostics */}
                  <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                    <span>
                      Diagnosis: <strong>{alert.modelDiagnosis}</strong>
                    </span>
                    <span>
                      Anomaly Score: <strong>{alert.anomalyScore} / 1.0</strong> ({alert.scoreInterpretation})
                    </span>
                    <span>
                      Models: <em>{alert.modelsUsed?.join(' + ')}</em>
                    </span>
                  </div>

                  {alert.diagnosticNote && (
                    <div style={{ fontSize: '0.7rem', color: '#9a3412', marginTop: '0.25rem', fontStyle: 'italic' }}>
                      ℹ Note: {alert.diagnosticNote}
                    </div>
                  )}
                </div>

                {/* Manager-Controlled Work Order Action */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    data-testid="create-wo-from-alert-btn"
                    onClick={() => handleOpenWorkOrderProposal(alert)}
                    style={{
                      background: '#ffffff',
                      color: '#0f766e',
                      border: '1.5px solid #0f766e',
                      borderRadius: '6px',
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}
                  >
                    <span>+ Review &amp; Dispatch Work Order</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. END-OF-RUN EVALUATION CARD (WHEN COMPLETED) */}
      {evaluationResult && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: '8px',
            padding: '1.25rem',
            border: '1.5px solid #bbf7d0',
            marginBottom: '1.25rem',
            boxShadow: '0 2px 6px rgba(34, 197, 94, 0.08)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1rem', color: '#16a34a' }}>✓</span>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#166534', margin: 0 }}>
                End-of-Run Scenario Demonstration Evaluation (Seed #{schedule.seed})
              </h2>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: '4px' }}>
                [SIMULATED RUN METRICS]
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleSaveRunAsDataset}
                disabled={actionLoading}
                style={{
                  background: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.35rem 0.8rem',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Save Run as Simulated Dataset
              </button>
              <button
                onClick={handleStartDemo}
                style={{
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Replay Run
              </button>
            </div>
          </div>

          {/* Metric KPI Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Injected Faults</span>
              <strong style={{ display: 'block', fontSize: '1.25rem', color: '#0f172a' }}>{evaluationResult.totalInjectedEvents}</strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Detected Events</span>
              <strong style={{ display: 'block', fontSize: '1.25rem', color: '#16a34a' }}>{evaluationResult.detectedEventsCount}</strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Missed Events</span>
              <strong style={{ display: 'block', fontSize: '1.25rem', color: evaluationResult.missedEventsCount > 0 ? '#dc2626' : '#64748b' }}>
                {evaluationResult.missedEventsCount}
              </strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>False Alerts (Baseline)</span>
              <strong style={{ display: 'block', fontSize: '1.25rem', color: evaluationResult.falseAlertsCount > 0 ? '#dc2626' : '#16a34a' }}>
                {evaluationResult.falseAlertsCount}
              </strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Mean Detection Latency</span>
              <strong style={{ display: 'block', fontSize: '1.25rem', color: '#0f766e' }}>
                {evaluationResult.meanDetectionDelaySeconds.toFixed(1)}s
              </strong>
            </div>
          </div>

          {/* Model & Version Disclosures */}
          <div style={{ background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.75rem', marginBottom: '0.65rem' }}>
            <strong style={{ color: '#1e293b' }}>Models &amp; Benchmarks Evaluated:</strong>
            <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0, color: '#475569' }}>
              <li><strong>Isolation Forest Anomaly Detector v1.0.0</strong> — Evaluates statistical distance from calibrated healthy baseline.</li>
              <li><strong>Random Forest Classifier v1.0.0 (SEU DDS Gearbox Benchmark)</strong> — Trained on parallel-shaft gear tooth wear only; unvalidated failure modes are truthfully flagged as out of domain.</li>
              <li><strong>Kinematic ODE Simulator v3.5</strong> — 100 Hz continuous numerical solver with strictly enforced gear ratio invariants.</li>
            </ul>
          </div>

          {/* Scientific Disclaimer */}
          <div style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic' }}>
            <strong>Demonstration Boundary Notice:</strong> {evaluationResult.disclaimer}
          </div>
        </div>
      )}

      {/* 6. Live Telemetry Mirror & Signals Graph */}
      <SimulatorLiveGraph
        liveSnapshot={liveSnapshot}
        simRunning={simRunning}
        activeFault={activeFault}
        onToggleRunning={() => {
          if (demoState === 'running') handlePauseDemo();
          else if (demoState === 'paused') handleResumeDemo();
          else handleStartDemo();
        }}
        machineId={selectedMachineId}
        connectionStatus={connectionStatus}
      />

      {/* Action / Notification Banner */}
      {actionStatus && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            border: actionStatus.type === 'error' ? '1px solid #FCA5A5' : actionStatus.type === 'warning' ? '1px solid #FDE68A' : actionStatus.type === 'success' ? '1px solid #A7F3D0' : '1px solid #BAE6FD',
            background: actionStatus.type === 'error' ? '#FEF2F2' : actionStatus.type === 'warning' ? '#FFFBEB' : actionStatus.type === 'success' ? '#ECFDF5' : '#F0F9FF',
            color: actionStatus.type === 'error' ? '#991B1B' : actionStatus.type === 'warning' ? '#92400E' : actionStatus.type === 'success' ? '#065F46' : '#075985'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                {actionStatus.title}
              </div>
              <div style={{ fontSize: '0.82rem', lineHeight: 1.4 }}>
                {actionStatus.message}
              </div>
            </div>
            <button
              onClick={() => setActionStatus(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700, fontSize: '1.1rem' }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Saved Dataset Confirmation Drawer */}
      {latestSavedDataset && (
        <div style={{ background: '#FFFFFF', borderRadius: '8px', padding: '1rem', border: '1px solid #E2E8F0', marginBottom: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="badge" style={{ backgroundColor: 'rgba(217, 119, 6, 0.15)', color: '#D97706', fontWeight: 700 }}>
                SIMULATED DATASET PERSISTED
              </span>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {latestSavedDataset.title}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => navigate(ROUTES.DATASETS)}
                className="btn btn-sm"
                style={{ background: '#0F766E', color: '#FFFFFF', border: 'none', padding: '0.35rem 0.75rem', fontSize: '0.78rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
              >
                View in Dataset Catalog ↗
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.82rem' }}>
            <div style={{ background: '#F8FAFC', padding: '0.6rem', borderRadius: '6px' }}>
              <span style={{ color: '#64748B', display: 'block', fontSize: '0.72rem' }}>Dataset ID</span>
              <strong style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                {latestSavedDataset._id}
              </strong>
            </div>
            <div style={{ background: '#F8FAFC', padding: '0.6rem', borderRadius: '6px' }}>
              <span style={{ color: '#64748B', display: 'block', fontSize: '0.72rem' }}>Total Rows</span>
              <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
                {latestSavedDataset.totalRows || '—'} samples
              </strong>
            </div>
            <div style={{ background: '#F8FAFC', padding: '0.6rem', borderRadius: '6px' }}>
              <span style={{ color: '#64748B', display: 'block', fontSize: '0.72rem' }}>Sampling Rate</span>
              <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
                {latestSavedDataset.samplingRateHz ? `${latestSavedDataset.samplingRateHz.toFixed(1)} Hz` : '10.0 Hz'}
              </strong>
            </div>
            <div style={{ background: '#F8FAFC', padding: '0.6rem', borderRadius: '6px' }}>
              <span style={{ color: '#64748B', display: 'block', fontSize: '0.72rem' }}>Provenance Tag</span>
              <strong style={{ fontSize: '0.85rem', color: 'var(--accent-teal, #0f766e)' }}>
                isSimulatorDerived: true
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* 7. Collapsible Advanced Diagnostics: Manual Fault Injection Controls */}
      <div style={{ background: '#FFFFFF', borderRadius: '8px', padding: '0.9rem', border: '1px solid #E2E8F0', marginBottom: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
        <details>
          <summary style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', cursor: 'pointer', outline: 'none' }}>
            Advanced Diagnostics: Individual Fault Injection Controls (Optional Manual Overrides)
          </summary>

          <div style={{ marginTop: '0.85rem' }}>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 0.75rem 0' }}>
              During normal automatic demonstrations, the scenario scheduler handles fault injection without manual input. Use these controls if you need to manually force an individual ODE parameter.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem', marginBottom: '0.85rem' }}>
              {FAULT_DEFINITIONS.map((fault) => {
                const isEnabled = Boolean(faultsState[fault.id]?.enabled);
                const severity = faultsState[fault.id]?.severity ?? fault.defaultSeverity;
                const pct = Math.round(severity * 100);

                return (
                  <div
                    key={fault.id}
                    style={{
                      background: isEnabled ? '#F0FDF4' : '#F8FAFC',
                      borderRadius: '6px',
                      padding: '0.75rem',
                      border: isEnabled ? '1.5px solid #10B981' : '1px solid #E2E8F0',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isEnabled ? '#065F46' : '#1E293B' }}>
                          {fault.name}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748B', fontWeight: 500 }}>
                          {fault.component}
                        </div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, color: isEnabled ? '#059669' : '#64748B' }}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => handleFaultToggle(fault.id, e.target.checked)}
                          style={{ width: '16px', height: '16px', accentColor: '#059669', cursor: 'pointer' }}
                        />
                        {isEnabled ? 'Active' : 'Off'}
                      </label>
                    </div>

                    <div style={{ fontSize: '0.72rem', color: '#475569', marginBottom: '0.5rem', lineHeight: 1.35 }}>
                      {fault.primaryEffects}
                    </div>

                    {/* Severity Slider */}
                    <div style={{ background: '#FFFFFF', padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', fontSize: '0.68rem' }}>
                        <span style={{ color: '#64748B', fontWeight: 600 }}>Severity Setting:</span>
                        <strong style={{ color: isEnabled ? '#047857' : '#334155', fontFamily: 'monospace' }}>
                          {pct}% ({fault.unit})
                        </strong>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        step="5"
                        value={pct}
                        onChange={(e) => handleFaultSeverityChange(fault.id, Number(e.target.value) / 100)}
                        disabled={!isEnabled}
                        style={{
                          width: '100%',
                          accentColor: '#059669',
                          cursor: isEnabled ? 'pointer' : 'not-allowed',
                          opacity: isEnabled ? 1 : 0.5
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      </div>

      {/* 8. Embedded 3D Digital Twin Simulator Iframe */}
      <div style={{ background: '#090A0C', borderRadius: '8px', overflow: 'hidden', border: '1px solid #2A2E34', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <div style={{ background: '#15181C', padding: '0.6rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2A2E34', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: simRunning ? '#10B981' : '#64748B' }} />
            <span style={{ color: '#F2F2F2', fontSize: '0.82rem', fontWeight: 600 }}>
              Transmission Dynamics Studio — Three.js WebGL Powertrain Cutaway (PRO v3.5)
            </span>
          </div>
          <span style={{ color: '#777F89', fontSize: '0.72rem' }}>
            Deterministic 100 Hz solver · 15 Channels · Verified HTML5 PostMessage Bridge
          </span>
        </div>
        <iframe
          ref={iframeRef}
          src="/simulator/transmission_dynamics_studio.html"
          title="Manual Transmission & Powertrain Simulator"
          style={{ width: '100%', height: '760px', border: 'none', display: 'block' }}
          sandbox="allow-scripts allow-same-origin allow-downloads allow-forms"
        />
      </div>

      {/* 9. Manager Work Order Proposal Modal (Explicit Human-in-the-Loop Approval) */}
      {isProposalModalOpen && (
        <div
          className="modal-overlay-glass"
          role="dialog"
          aria-modal="true"
          aria-labelledby="proposal-modal-title"
        >
          <div data-testid="proposal-modal" className="modal-dialog-glass" style={{ maxWidth: '620px' }}>
            <div className="modal-header-glass">
              <h3 id="proposal-modal-title" className="modal-title-glass">
                Review &amp; Dispatch Work Order Proposal
              </h3>
              <button
                type="button"
                onClick={() => setIsProposalModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                aria-label="Close dialog"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitWorkOrderProposal}>
              <div className="modal-body-glass">
                {proposalError && (
                  <div
                    style={{
                      background: 'var(--status-critical-bg, #fef2f2)',
                      border: '1px solid var(--status-critical-border, #fecaca)',
                      color: 'var(--status-critical, #dc2626)',
                      padding: '0.55rem 0.85rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem'
                    }}
                  >
                    {proposalError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Target Equipment</label>
                  <input
                    type="text"
                    className="form-input"
                    value={proposalForm.machineCode}
                    readOnly
                    style={{ background: '#f8fafc', fontWeight: 700 }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Work Order Title</label>
                  <input
                    type="text"
                    className="form-input"
                    value={proposalForm.title}
                    onChange={(e) => setProposalForm({ ...proposalForm, title: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Diagnostic Context &amp; Inspection Evidence</label>
                  <textarea
                    className="form-textarea"
                    style={{ minHeight: '110px', resize: 'vertical' }}
                    value={proposalForm.description}
                    onChange={(e) => setProposalForm({ ...proposalForm, description: e.target.value })}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                  <div className="form-group">
                    <label className="form-label">Priority Level</label>
                    <select
                      className="form-select"
                      value={proposalForm.priority}
                      onChange={(e) => setProposalForm({ ...proposalForm, priority: e.target.value })}
                    >
                      <option value={WORK_ORDER_PRIORITY.CRITICAL}>CRITICAL — Immediate Inspection</option>
                      <option value={WORK_ORDER_PRIORITY.HIGH}>HIGH — Degraded Condition</option>
                      <option value={WORK_ORDER_PRIORITY.MEDIUM}>MEDIUM — Scheduled Inspection</option>
                      <option value={WORK_ORDER_PRIORITY.LOW}>LOW — Routine Maintenance</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Target Completion Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={proposalForm.dueDate}
                      onChange={(e) => setProposalForm({ ...proposalForm, dueDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Assign Authorized Field Technician</label>
                  <select
                    className="form-select"
                    value={proposalForm.assignedTechnicianId}
                    onChange={(e) => setProposalForm({ ...proposalForm, assignedTechnicianId: e.target.value })}
                    required
                  >
                    {technicians.length === 0 ? (
                      <option value="">No technicians discovered in factory scope</option>
                    ) : (
                      technicians.map((tech) => (
                        <option key={tech._id} value={tech._id}>
                          {tech.fullName} ({tech.email}) — Field Technician
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="modal-footer-glass">
                <button
                  data-testid="proposal-cancel-btn"
                  type="button"
                  onClick={() => setIsProposalModalOpen(false)}
                  disabled={isSubmittingProposal}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingProposal}
                  style={{
                    background: '#0f766e',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {isSubmittingProposal ? 'Dispatching...' : 'Confirm & Dispatch Work Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
