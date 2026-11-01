/**
 * Machine type and sensor signal definitions.
 * Initial focus: Industrial Multi-Stage Gearbox.
 */
export const MACHINE_TYPES = Object.freeze({
  GEARBOX: 'gearbox'
});

export const SIGNAL_CATEGORIES = Object.freeze({
  VIBRATION: 'vibration',
  THERMAL: 'thermal',
  OPERATING_REGIME: 'operating_regime'
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

