/**
 * Explicitly labeled Demo and Simulated specimens for Phase 2 Product Shells.
 * ARCHITECTURAL MANDATE: Any sample machine, alert, or dataset must be visibly labeled DEMO or SIMULATED.
 */
import { ALERT_SEVERITIES, ALERT_STATUSES, ANALYSIS_METHODS } from './alerts.js';
import { MACHINE_TYPES, SIGNAL_CATEGORIES } from './signals.js';

export const DEMO_FACTORY = Object.freeze({
  id: 'fac-pune-02',
  name: 'Pune Precision Powertrains Plant #2',
  scopeLabel: 'Factory Scope: Pune #2 [DEMO]',
  organization: 'Bharat Heavy Powertrain Dynamics Ltd. [DEMO]',
  location: 'Chakan Industrial Corridor, Pune, Maharashtra, India',
  isDemo: true
});

export const DEMO_USER = Object.freeze({
  id: 'usr-demo-01',
  name: 'Rajesh Kumar',
  role: 'technician',
  roleDisplay: 'Lead Reliability Technician',
  factoryId: 'fac-pune-02',
  assignedMachines: ['GB-104'],
  badgeLabel: 'DEMO USER (Technician)',
  isDemo: true
});

export const DEMO_MACHINES = Object.freeze([
  {
    id: 'GB-104',
    name: 'Main Extruder Drive Gearbox',
    type: MACHINE_TYPES.GEARBOX,
    site: 'Extrusion Line 4',
    status: 'warning',
    statusLabel: 'Attention Recommended [DEMO]',
    isDemo: true,
    simulationLabel: 'DEMO SPECIMEN',
    manufacturer: 'Elecon Engineering / Siemens Flender',
    model: 'B3SH-10',
    gearRatio: '14.2:1',
    ratedSpeedRpm: 1780,
    ratedTorqueNm: 480,
    lubricantType: 'ISO VG 220 Synthetic',
    installDate: '2022-03-15',
    lastDatasetUpload: '2026-10-28 14:30 UTC',
    assignedTechnician: 'Rajesh Kumar (Lead Reliability Technician)',
    stages: [
      { stage: 1, type: 'Planetary Stage', ratio: '3.5:1', condition: 'Nominal [DEMO]' },
      { stage: 2, type: 'Helical Output Stage', ratio: '4.06:1', condition: 'Elevated Radial Motion [DEMO]' }
    ],
    monitoredSignals: [
      { key: 'vibration_input_axial', label: 'Vibration Input Shaft (Axial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'vibration_input_radial', label: 'Vibration Input Shaft (Radial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'vibration_output_radial', label: 'Vibration Output Shaft (Radial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'temp_gearbox_sump', label: 'Oil Sump Temperature', unit: '°C', category: SIGNAL_CATEGORIES.THERMAL },
      { key: 'temp_bearing_input', label: 'Input Bearing Temperature', unit: '°C', category: SIGNAL_CATEGORIES.THERMAL },
      { key: 'rotational_speed', label: 'Shaft Speed', unit: 'RPM', category: SIGNAL_CATEGORIES.OPERATING_REGIME },
      { key: 'load_torque', label: 'Torque / Load', unit: 'Nm', category: SIGNAL_CATEGORIES.OPERATING_REGIME }
    ]
  },
  {
    id: 'GB-201',
    name: 'Cooling Water Circulator Gearbox',
    type: MACHINE_TYPES.GEARBOX,
    site: 'Utility Bay B',
    status: 'healthy',
    statusLabel: 'Nominal Condition [DEMO]',
    isDemo: true,
    simulationLabel: 'DEMO SPECIMEN',
    manufacturer: 'SEW-Eurodrive Bevel-Helical',
    model: 'K77-DRE132',
    gearRatio: '9.8:1',
    ratedSpeedRpm: 1450,
    ratedTorqueNm: 310,
    lubricantType: 'ISO VG 150 Mineral',
    installDate: '2023-08-10',
    lastDatasetUpload: '2026-10-25 09:12 UTC',
    assignedTechnician: 'Rajesh Kumar (Lead Reliability Technician)',
    stages: [
      { stage: 1, type: 'Bevel Stage', ratio: '2.5:1', condition: 'Nominal [DEMO]' },
      { stage: 2, type: 'Helical Stage', ratio: '3.92:1', condition: 'Nominal [DEMO]' }
    ],
    monitoredSignals: [
      { key: 'vibration_input_radial', label: 'Vibration Input Shaft (Radial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'temp_gearbox_sump', label: 'Oil Sump Temperature', unit: '°C', category: SIGNAL_CATEGORIES.THERMAL },
      { key: 'rotational_speed', label: 'Shaft Speed', unit: 'RPM', category: SIGNAL_CATEGORIES.OPERATING_REGIME }
    ]
  }
]);

export const DEMO_ALERTS = Object.freeze([
  {
    id: 'ALT-2026-104-01',
    machineId: 'GB-104',
    machineName: 'Main Extruder Drive Gearbox',
    severity: ALERT_SEVERITIES.WARNING,
    status: ALERT_STATUSES.OPEN,
    title: 'Elevated Pinion Radial Vibration [SIMULATED]',
    description: 'Radial velocity on high-speed pinion exceeds ISO 10816 Zone B baseline (4.2 mm/s vs 2.8 mm/s nominal). Sump temperature remains normal (54°C), indicating early mechanical unbalance or gear mesh roughness rather than lubrication friction.',
    method: ANALYSIS_METHODS.THRESHOLD_BASELINE,
    methodLabel: 'Engineering Threshold (ISO 10816-3)',
    timestamp: '2026-10-31T09:15:00Z',
    contributingSignals: [
      { signal: 'Vibration Input Radial', value: '4.2 mm/s', baseline: '2.8 mm/s', delta: '+50%' },
      { signal: 'Vibration Input Axial', value: '2.1 mm/s', baseline: '1.9 mm/s', delta: '+10%' }
    ],
    unaffectedSignals: [
      { signal: 'Oil Sump Temperature', value: '54.2 °C', baseline: '52.0 °C', note: 'Thermal channel normal' }
    ],
    dataSufficiency: '98.5% (4,800 samples @ 100 Hz, zero missing packets)',
    isSimulated: true
  }
]);

export const DEMO_DATASETS = Object.freeze([
  {
    id: 'ds-sim-2026-001',
    machineId: 'GB-104',
    filename: 'GB104_run_2026_10_28_baseline.csv',
    recordType: 'Operational Upload [SIMULATED]',
    uploadedAt: '2026-10-28 14:30 UTC',
    fileSizeBytes: 2457600,
    fileSizeDisplay: '2.4 MB',
    rowCount: 24000,
    samplingRateHz: 100,
    durationDisplay: '4 hours',
    coveragePct: 99.8,
    missingValues: 0,
    provenance: 'Simulated operational bench run (1780 RPM nominal load)',
    isDemo: true
  }
]);

export const DEMO_MAINTENANCE_NOTES = Object.freeze([
  {
    id: 'mnt-001',
    machineId: 'GB-104',
    author: 'Alex Mercer (Technician)',
    timestamp: '2026-10-29 11:45 UTC',
    category: 'Inspection & Lubrication',
    content: 'Visual gearbox inspection conducted during scheduled downtime. Inspected drive-end labyrinth seal for weeping. Replenished 250ml synthetic gear oil (ISO VG 220). Scheduled vibration probe recalibration for next shift. [DEMO NOTE]',
    status: 'Completed',
    isDemo: true
  }
]);

