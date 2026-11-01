/**
 * Machine type, industry sector, and sensor signal definitions.
 * Supports multi-industry asset health monitoring:
 * - Gearboxes (Manufacturing / Mining)
 * - Centrifugal Pumps (Water / Process / Utilities)
 * - Electric Motors (Manufacturing / Energy)
 * - Industrial Compressors (Chemical / Process / Utilities)
 */
export const MACHINE_TYPES = Object.freeze({
  GEARBOX: 'gearbox',
  CENTRIFUGAL_PUMP: 'centrifugal_pump',
  ELECTRIC_MOTOR: 'electric_motor',
  COMPRESSOR: 'compressor'
});

export const MACHINE_TYPE_LABELS = Object.freeze({
  [MACHINE_TYPES.GEARBOX]: 'Industrial Multi-Stage Gearbox',
  [MACHINE_TYPES.CENTRIFUGAL_PUMP]: 'Centrifugal Process Pump',
  [MACHINE_TYPES.ELECTRIC_MOTOR]: 'Three-Phase Induction Motor',
  [MACHINE_TYPES.COMPRESSOR]: 'Industrial Rotary / Screw Compressor'
});

export const INDUSTRIES = Object.freeze({
  MANUFACTURING: 'manufacturing',
  ENERGY_UTILITIES: 'energy_utilities',
  CHEMICAL_PROCESS: 'chemical_process',
  WATER_WASTEWATER: 'water_wastewater',
  MINING_HEAVY_ENG: 'mining_heavy_eng'
});

export const INDUSTRY_LABELS = Object.freeze({
  [INDUSTRIES.MANUFACTURING]: 'Automotive & Precision Manufacturing',
  [INDUSTRIES.ENERGY_UTILITIES]: 'Energy, Thermal & Power Utilities',
  [INDUSTRIES.CHEMICAL_PROCESS]: 'Chemical Processing & Petrochemicals',
  [INDUSTRIES.WATER_WASTEWATER]: 'Water Treatment & Public Utilities',
  [INDUSTRIES.MINING_HEAVY_ENG]: 'Heavy Engineering & Mining'
});

export const SIGNAL_CATEGORIES = Object.freeze({
  VIBRATION: 'vibration',
  THERMAL: 'thermal',
  OPERATING_REGIME: 'operating_regime',
  PRESSURE: 'pressure',
  ELECTRICAL: 'electrical',
  FLOW: 'flow'
});

export const GEARBOX_SIGNALS = Object.freeze({
  VIBRATION_INPUT_AXIAL: {
    key: 'vibration_input_axial',
    label: 'Vibration Input Shaft (Axial)',
    category: SIGNAL_CATEGORIES.VIBRATION,
    standardUnit: 'mm/s',
    supportedUnits: ['mm/s', 'g', 'm/s2'],
    description: 'High-frequency axial vibration on input drive pinion shaft.'
  },
  VIBRATION_INPUT_RADIAL: {
    key: 'vibration_input_radial',
    label: 'Vibration Input Shaft (Radial)',
    category: SIGNAL_CATEGORIES.VIBRATION,
    standardUnit: 'mm/s',
    supportedUnits: ['mm/s', 'g', 'm/s2'],
    description: 'Radial vibration measuring mesh impacts and unbalance on input.'
  },
  VIBRATION_OUTPUT_RADIAL: {
    key: 'vibration_output_radial',
    label: 'Vibration Output Shaft (Radial)',
    category: SIGNAL_CATEGORIES.VIBRATION,
    standardUnit: 'mm/s',
    supportedUnits: ['mm/s', 'g', 'm/s2'],
    description: 'Output low-speed stage radial vibration for gear meshing and load defects.'
  },
  TEMPERATURE_GEARBOX_SUMP: {
    key: 'temp_gearbox_sump',
    label: 'Oil Sump Temperature',
    category: SIGNAL_CATEGORIES.THERMAL,
    standardUnit: 'degC',
    supportedUnits: ['degC', 'degF', 'K'],
    description: 'Bulk lubrication oil temperature inside gearbox casing.'
  },
  TEMPERATURE_BEARING: {
    key: 'temp_bearing_input',
    label: 'Input Bearing Temperature',
    category: SIGNAL_CATEGORIES.THERMAL,
    standardUnit: 'degC',
    supportedUnits: ['degC', 'degF', 'K'],
    description: 'Localized temperature sensor embedded on drive end bearing housing.'
  },
  ROTATIONAL_SPEED: {
    key: 'rotational_speed',
    label: 'Shaft Speed',
    category: SIGNAL_CATEGORIES.OPERATING_REGIME,
    standardUnit: 'RPM',
    supportedUnits: ['RPM', 'Hz', 'rad/s'],
    description: 'Operating rotational speed driving the transmission.'
  },
  LOAD_TORQUE: {
    key: 'load_torque',
    label: 'Torque / Load',
    category: SIGNAL_CATEGORIES.OPERATING_REGIME,
    standardUnit: 'Nm',
    supportedUnits: ['Nm', 'kNm', 'pct_load'],
    description: 'Transmitted mechanical load torque applied across stages.'
  }
});

export const PUMP_SIGNALS = Object.freeze({
  VIBRATION_DRIVE_END: {
    key: 'vibration_pump_drive_end',
    label: 'Pump Drive-End Radial Vibration',
    category: SIGNAL_CATEGORIES.VIBRATION,
    standardUnit: 'mm/s',
    supportedUnits: ['mm/s', 'g'],
    description: 'Radial vibration at drive end bearing housing measuring cavitation and unbalance.'
  },
  DISCHARGE_PRESSURE: {
    key: 'discharge_pressure',
    label: 'Discharge Fluid Pressure',
    category: SIGNAL_CATEGORIES.PRESSURE,
    standardUnit: 'bar',
    supportedUnits: ['bar', 'kPa', 'psi'],
    description: 'Outlet line hydraulic pressure.'
  },
  SUCTION_PRESSURE: {
    key: 'suction_pressure',
    label: 'Suction Inlet Pressure',
    category: SIGNAL_CATEGORIES.PRESSURE,
    standardUnit: 'bar',
    supportedUnits: ['bar', 'kPa', 'psi'],
    description: 'Inlet hydraulic pressure monitoring for cavitation margin.'
  },
  FLOW_RATE: {
    key: 'flow_rate',
    label: 'Discharge Volumetric Flow Rate',
    category: SIGNAL_CATEGORIES.FLOW,
    standardUnit: 'm3/h',
    supportedUnits: ['m3/h', 'L/min', 'gpm'],
    description: 'Volumetric flow delivered by pump.'
  },
  BEARING_TEMP_PUMP: {
    key: 'temp_pump_bearing',
    label: 'Pump Bearing Housing Temperature',
    category: SIGNAL_CATEGORIES.THERMAL,
    standardUnit: 'degC',
    supportedUnits: ['degC', 'degF'],
    description: 'Embedded RTD sensor at pump mechanical seal and bearing.'
  }
});

export const MOTOR_SIGNALS = Object.freeze({
  VIBRATION_MOTOR_RADIAL: {
    key: 'vibration_motor_radial',
    label: 'Motor DE Radial Vibration',
    category: SIGNAL_CATEGORIES.VIBRATION,
    standardUnit: 'mm/s',
    supportedUnits: ['mm/s', 'g'],
    description: 'Radial vibration on stator drive end detecting rotor eccentricity and unbalance.'
  },
  PHASE_CURRENT_RMS: {
    key: 'phase_current_rms',
    label: 'Stator Phase Current RMS',
    category: SIGNAL_CATEGORIES.ELECTRICAL,
    standardUnit: 'A',
    supportedUnits: ['A', 'kA'],
    description: 'Root mean square current indicating electrical load unbalance.'
  },
  STATOR_WINDING_TEMP: {
    key: 'temp_stator_winding',
    label: 'Stator Winding Temperature',
    category: SIGNAL_CATEGORIES.THERMAL,
    standardUnit: 'degC',
    supportedUnits: ['degC', 'degF'],
    description: 'Embedded PT100 RTD in stator coil slots.'
  },
  ROTATIONAL_SPEED: {
    key: 'rotational_speed',
    label: 'Synchronous / Rotor Speed',
    category: SIGNAL_CATEGORIES.OPERATING_REGIME,
    standardUnit: 'RPM',
    supportedUnits: ['RPM', 'Hz'],
    description: 'Measured rotor shaft rotational velocity.'
  }
});

export const COMPRESSOR_SIGNALS = Object.freeze({
  VIBRATION_COMPRESSOR_RADIAL: {
    key: 'vibration_compressor_radial',
    label: 'Compressor Casing Vibration',
    category: SIGNAL_CATEGORIES.VIBRATION,
    standardUnit: 'mm/s',
    supportedUnits: ['mm/s', 'g'],
    description: 'Broadband vibration on screw/cylinder casing.'
  },
  STAGE1_DISCHARGE_PRESSURE: {
    key: 'stage1_discharge_pressure',
    label: 'Stage 1 Discharge Pressure',
    category: SIGNAL_CATEGORIES.PRESSURE,
    standardUnit: 'bar',
    supportedUnits: ['bar', 'kPa', 'psi'],
    description: 'Inter-stage gas pressure.'
  },
  STAGE2_DISCHARGE_PRESSURE: {
    key: 'stage2_discharge_pressure',
    label: 'Final Discharge Pressure',
    category: SIGNAL_CATEGORIES.PRESSURE,
    standardUnit: 'bar',
    supportedUnits: ['bar', 'kPa', 'psi'],
    description: 'Final delivery manifold pressure.'
  },
  STAGE2_DISCHARGE_TEMP: {
    key: 'stage2_discharge_temp',
    label: 'Discharge Gas Temperature',
    category: SIGNAL_CATEGORIES.THERMAL,
    standardUnit: 'degC',
    supportedUnits: ['degC', 'degF'],
    description: 'Gas temperature following final compression stage.'
  }
});
