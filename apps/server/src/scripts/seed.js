import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Organization } from '../models/Organization.js';
import { Factory } from '../models/Factory.js';
import { Site } from '../models/Site.js';
import { Machine } from '../models/Machine.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import {
  USER_ROLES,
  MACHINE_TYPES,
  SIGNAL_CATEGORIES,
  OPERATIONAL_STATUS,
  WORK_ORDER_STATUS,
  WORK_ORDER_PRIORITY
} from '@predictive-maintenance/shared';

// Development demo passwords (strictly development only)
const DEMO_MANAGER_PW = process.env.DEMO_MANAGER_PASSWORD || 'Manager123!';
const DEMO_TECH_PW = process.env.DEMO_TECH_PASSWORD || 'Tech123!';
const DEMO_VIEWER_PW = process.env.DEMO_VIEWER_PASSWORD || 'Viewer123!';

async function seed() {
  // Strict production lockout: demo accounts and sample telemetry must NEVER be created in production
  if (env.isProd || process.env.NODE_ENV === 'production') {
    console.error('============================================================');
    console.error('[Seed] FATAL: Seeder execution blocked in production mode.');
    console.error('[Seed] Demo accounts and sample telemetry must NEVER be created in production.');
    console.error('============================================================');
    process.exit(1);
  }

  console.log('============================================================');
  console.log('Predictive Maintenance System — Development Database Seeder');
  console.log('Connecting to MongoDB:', env.MONGODB_URI);
  console.log('============================================================');

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  });

  console.log('[Seed] Purging existing development collections...');
  await Promise.all([
    Organization.deleteMany({}),
    Factory.deleteMany({}),
    Site.deleteMany({}),
    Machine.deleteMany({}),
    User.deleteMany({}),
    Session.deleteMany({}),
    MaintenanceWorkOrder.deleteMany({})
  ]);

  // 1. Create Organization
  console.log('[Seed] Creating Organization...');
  const org = await Organization.create({
    name: 'Apex Industrial Manufacturing',
    code: 'APEX_MFG'
  });

  // 2. Create Factory 1 (Detroit Plant #2)
  console.log('[Seed] Creating Factory 1 (Detroit)...');
  const factoryDetroit = await Factory.create({
    organizationId: org._id,
    name: 'Detroit Powertrain Plant #2',
    code: 'DETROIT_02',
    location: 'Detroit, MI, USA'
  });

  // 3. Create Sites in Factory 1
  const siteLine4 = await Site.create({
    factoryId: factoryDetroit._id,
    name: 'Extrusion Line 4',
    code: 'EXTR_L4',
    area: 'Primary Polymer Processing',
    description: 'High-torque twin screw extruder drive cell'
  });

  const siteBayB = await Site.create({
    factoryId: factoryDetroit._id,
    name: 'Utility Bay B',
    code: 'UTIL_BAY_B',
    area: 'Cooling & Recirculation',
    description: 'Central plant cooling water and fluid circulation drives'
  });

  const siteMachining = await Site.create({
    factoryId: factoryDetroit._id,
    name: 'CNC Machining Bay 1',
    code: 'CNC_BAY_1',
    area: 'Precision Milling',
    description: 'Heavy gantry milling machine gearboxes'
  });

  // 4. Create Passwords & Users for Detroit
  console.log('[Seed] Creating Factory 1 Users...');
  const managerPasswordHash = await User.hashPassword(DEMO_MANAGER_PW);
  const techPasswordHash = await User.hashPassword(DEMO_TECH_PW);
  const viewerPasswordHash = await User.hashPassword(DEMO_VIEWER_PW);

  const managerUser = await User.create({
    email: 'manager@detroit.factory',
    username: 'manager_detroit',
    fullName: 'Sarah Vance',
    passwordHash: managerPasswordHash,
    role: USER_ROLES.FACTORY_MANAGER,
    organizationId: org._id,
    factoryId: factoryDetroit._id,
    assignedSites: [siteLine4._id, siteBayB._id, siteMachining._id],
    assignedMachines: []
  });

  const techUser = await User.create({
    email: 'tech@detroit.factory',
    username: 'tech_detroit',
    fullName: 'Alex Mercer',
    passwordHash: techPasswordHash,
    role: USER_ROLES.TECHNICIAN,
    organizationId: org._id,
    factoryId: factoryDetroit._id,
    assignedSites: [siteLine4._id],
    assignedMachines: []
  });

  const viewerUser = await User.create({
    email: 'viewer@detroit.factory',
    username: 'viewer_detroit',
    fullName: 'David Sterling',
    passwordHash: viewerPasswordHash,
    role: USER_ROLES.VIEWER,
    organizationId: org._id,
    factoryId: factoryDetroit._id,
    assignedSites: [siteLine4._id, siteBayB._id],
    assignedMachines: []
  });

  // 5. Create Machines in Factory 1
  console.log('[Seed] Creating Gearbox Specimens in Detroit...');
  const machineGB104 = await Machine.create({
    factoryId: factoryDetroit._id,
    siteId: siteLine4._id,
    code: 'GB-104',
    name: 'Main Extruder Drive Gearbox',
    type: MACHINE_TYPES.GEARBOX,
    manufacturer: 'Siemens / Flender Helical-Planetary',
    model: 'B3SH-10',
    serialNumber: 'SN-FL-2023-8841',
    operationalStatus: OPERATIONAL_STATUS.OPERATIONAL,
    status: 'warning',
    isDecommissioned: false,
    arrangement: 'Helical-Planetary',
    stageCount: 2,
    gearRatio: '14.2:1',
    ratedSpeedRpm: 1780,
    ratedTorqueNm: 480,
    stages: [
      {
        stage: 1,
        type: 'Planetary Reduction Stage',
        ratio: '3.5:1',
        teethPinion: 18,
        teethGear: 63,
        conditionNotes: 'Sun pinion tooth engagement nominal [DEMO]'
      },
      {
        stage: 2,
        type: 'Helical Output Stage',
        ratio: '4.06:1',
        teethPinion: 16,
        teethGear: 65,
        conditionNotes: 'Elevated low-speed radial vibration detected on output pinion [DEMO]'
      }
    ],
    bearingPositions: [
      {
        position: 'Input Shaft Drive-End (DE)',
        bearingType: 'Spherical Roller Bearing',
        bearingModel: 'SKF 22210 E'
      },
      {
        position: 'Intermediate Planetary Carrier',
        bearingType: 'Cylindrical Roller Bearing',
        bearingModel: 'FAG NJ 212'
      },
      {
        position: 'Low-Speed Output Shaft (NDE)',
        bearingType: 'Tapered Roller Bearing',
        bearingModel: 'Timken 32218'
      }
    ],
    lubrication: {
      oilType: 'Synthetic Polyalphaolefin (PAO)',
      isoVgGrade: 'ISO VG 220',
      capacityLiters: 18.5,
      serviceIntervalHours: 4000,
      lastServiceDate: new Date('2026-09-15')
    },
    lubricantType: 'ISO VG 220 Synthetic',
    monitoredSignals: [
      { key: 'vibration_input_axial', label: 'Vibration Input Shaft (Axial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'vibration_input_radial', label: 'Vibration Input Shaft (Radial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'vibration_output_radial', label: 'Vibration Output Shaft (Radial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'temp_gearbox_sump', label: 'Oil Sump Temperature', unit: '°C', category: SIGNAL_CATEGORIES.THERMAL },
      { key: 'temp_bearing_input', label: 'Input Bearing Temperature', unit: '°C', category: SIGNAL_CATEGORIES.THERMAL },
      { key: 'rotational_speed', label: 'Shaft Speed', unit: 'RPM', category: SIGNAL_CATEGORIES.OPERATING_REGIME },
      { key: 'load_torque', label: 'Torque / Load', unit: 'Nm', category: SIGNAL_CATEGORIES.OPERATING_REGIME }
    ],
    assignedTechnicians: [techUser._id],
    notes: [
      {
        author: 'Alex Mercer (technician)',
        authorId: techUser._id,
        category: 'Field Inspection',
        content: 'Inspected drive-end labyrinth seal for weeping. Replenished 250ml synthetic gear oil.',
        timestamp: new Date('2026-10-29T11:45:00Z')
      }
    ]
  });

  const machineGB201 = await Machine.create({
    factoryId: factoryDetroit._id,
    siteId: siteBayB._id,
    code: 'GB-201',
    name: 'Cooling Water Circulator Gearbox',
    type: MACHINE_TYPES.GEARBOX,
    manufacturer: 'SEW-Eurodrive Bevel-Helical',
    model: 'K77-DRE132',
    serialNumber: 'SN-SEW-2022-1092',
    operationalStatus: OPERATIONAL_STATUS.OPERATIONAL,
    status: 'healthy',
    isDecommissioned: false,
    arrangement: 'Bevel-Helical',
    stageCount: 2,
    gearRatio: '9.8:1',
    ratedSpeedRpm: 1450,
    ratedTorqueNm: 310,
    stages: [
      { stage: 1, type: 'Bevel Input Stage', ratio: '2.5:1', conditionNotes: 'Nominal condition [DEMO]' },
      { stage: 2, type: 'Helical Output Stage', ratio: '3.92:1', conditionNotes: 'Nominal condition [DEMO]' }
    ],
    bearingPositions: [
      { position: 'Bevel Pinion Head', bearingType: 'Tapered Roller Pair', bearingModel: 'SKF 32309' },
      { position: 'Output Hollow Shaft', bearingType: 'Deep Groove Ball', bearingModel: 'NSK 6214' }
    ],
    lubrication: {
      oilType: 'Mineral Industrial Gear Oil',
      isoVgGrade: 'ISO VG 150',
      capacityLiters: 8.0,
      serviceIntervalHours: 2500,
      lastServiceDate: new Date('2026-08-01')
    },
    lubricantType: 'ISO VG 150 Mineral',
    monitoredSignals: [
      { key: 'vibration_input_radial', label: 'Vibration Input Shaft (Radial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'temp_gearbox_sump', label: 'Oil Sump Temperature', unit: '°C', category: SIGNAL_CATEGORIES.THERMAL },
      { key: 'rotational_speed', label: 'Shaft Speed', unit: 'RPM', category: SIGNAL_CATEGORIES.OPERATING_REGIME }
    ],
    assignedTechnicians: [],
    notes: []
  });

  // Assign machines to users
  managerUser.assignedMachines = [machineGB104._id, machineGB201._id];
  techUser.assignedMachines = [machineGB104._id]; // Assigned exclusively to GB-104!
  viewerUser.assignedMachines = [machineGB104._id, machineGB201._id];

  await Promise.all([managerUser.save(), techUser.save(), viewerUser.save()]);

  // 6. Create Maintenance Work Orders in Detroit
  console.log('[Seed] Creating Maintenance Work Orders in Detroit...');
  const order1 = await MaintenanceWorkOrder.create({
    factoryId: factoryDetroit._id,
    machineId: machineGB104._id,
    orderNumber: 'WO-GB104-001',
    title: 'Inspect Drive-End Labyrinth Seal & Replenish Lubricant',
    description: 'Check for oil weeping around the drive-end labyrinth seal. Inspect sight glass and top up with ISO VG 220 synthetic oil.',
    priority: WORK_ORDER_PRIORITY.HIGH,
    status: WORK_ORDER_STATUS.IN_PROGRESS,
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Due in 3 days
    assignedTechnicianId: techUser._id,
    createdById: managerUser._id,
    statusHistory: [
      {
        status: WORK_ORDER_STATUS.OPEN,
        changedById: managerUser._id,
        changedByName: managerUser.fullName,
        changedByRole: managerUser.role,
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
        note: 'Work order created and assigned to Alex Mercer.'
      },
      {
        status: WORK_ORDER_STATUS.IN_PROGRESS,
        changedById: techUser._id,
        changedByName: techUser.fullName,
        changedByRole: techUser.role,
        timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000),
        note: 'Technician accepted work order and commenced seal inspection.'
      }
    ]
  });

  const order2 = await MaintenanceWorkOrder.create({
    factoryId: factoryDetroit._id,
    machineId: machineGB104._id,
    orderNumber: 'WO-GB104-002',
    title: 'Baseline Vibration Transducer Calibration',
    description: 'Verify mounting torque and calibration constants for axial and radial accelerometers on input shaft.',
    priority: WORK_ORDER_PRIORITY.MEDIUM,
    status: WORK_ORDER_STATUS.REVIEWED,
    dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    completedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    reviewedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    reviewedById: managerUser._id,
    reviewNotes: 'Calibration records reviewed and verified against ISO 10816 standards.',
    assignedTechnicianId: techUser._id,
    createdById: managerUser._id,
    technicianFeedback: {
      findings: 'Accelerometers secured to 8 Nm torque. No stud loosening or cable wear observed.',
      workPerformed: 'Calibrated signals against reference shaker. Output signal response verified within ±1.5%.',
      followUpNeeded: 'Routine check at next 1000-hour service window.',
      submittedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    },
    statusHistory: [
      {
        status: WORK_ORDER_STATUS.OPEN,
        changedById: managerUser._id,
        changedByName: managerUser.fullName,
        changedByRole: managerUser.role,
        timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        note: 'Work order created.'
      },
      {
        status: WORK_ORDER_STATUS.COMPLETED,
        changedById: techUser._id,
        changedByName: techUser.fullName,
        changedByRole: techUser.role,
        timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
        note: 'Work completed.'
      },
      {
        status: WORK_ORDER_STATUS.REVIEWED,
        changedById: managerUser._id,
        changedByName: managerUser.fullName,
        changedByRole: managerUser.role,
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        note: 'Reviewed and closed by plant manager.'
      }
    ]
  });

  // 7. Create Factory 2 (Cleveland Plant #1) for Cross-Factory Scoping Tests
  console.log('[Seed] Creating Factory 2 (Cleveland) for Cross-Factory Authorization Tests...');
  const factoryCleveland = await Factory.create({
    organizationId: org._id,
    name: 'Cleveland Gear Works #1',
    code: 'CLEVELAND_01',
    location: 'Cleveland, OH, USA'
  });

  const siteClevelandBay = await Site.create({
    factoryId: factoryCleveland._id,
    name: 'Testing Bay 1',
    code: 'TEST_BAY_1'
  });

  const machineGB999 = await Machine.create({
    factoryId: factoryCleveland._id,
    siteId: siteClevelandBay._id,
    code: 'GB-999',
    name: 'High-Speed Pinion Rig',
    type: MACHINE_TYPES.GEARBOX,
    manufacturer: 'Horsburgh & Scott',
    model: 'HS-Test-4',
    serialNumber: 'SN-HS-TEST-99',
    status: 'healthy',
    operationalStatus: OPERATIONAL_STATUS.OPERATIONAL,
    gearRatio: '8.4:1',
    ratedSpeedRpm: 2400,
    ratedTorqueNm: 600,
    stages: [],
    monitoredSignals: []
  });

  const clevelandManager = await User.create({
    email: 'manager@cleveland.factory',
    username: 'manager_cleveland',
    fullName: 'Elena Rostova',
    passwordHash: managerPasswordHash,
    role: USER_ROLES.FACTORY_MANAGER,
    organizationId: org._id,
    factoryId: factoryCleveland._id,
    assignedSites: [siteClevelandBay._id],
    assignedMachines: [machineGB999._id]
  });

  console.log('\n============================================================');
  console.log('Database Seeding Completed Successfully!');
  console.log('============================================================');
  console.log('Demo Accounts for Factory 1 (Detroit Powertrain Plant #2):');
  console.log('  1. Factory Manager:');
  console.log('     - Email:    manager@detroit.factory');
  console.log('     - Username: manager_detroit');
  console.log(`     - Password: ${DEMO_MANAGER_PW}`);
  console.log('     - Scope:    Full access to Detroit Plant (GB-104, GB-201, Sites, Work Orders)');
  console.log('  2. Technician:');
  console.log('     - Email:    tech@detroit.factory');
  console.log('     - Username: tech_detroit');
  console.log(`     - Password: ${DEMO_TECH_PW}`);
  console.log('     - Scope:    Assigned to GB-104 only; assigned WO-GB104-001; write notes');
  console.log('  3. Viewer:');
  console.log('     - Email:    viewer@detroit.factory');
  console.log('     - Username: viewer_detroit');
  console.log(`     - Password: ${DEMO_VIEWER_PW}`);
  console.log('     - Scope:    Read-only assigned equipment; cannot post notes/work orders');
  console.log('\nCross-Factory Test Asset in Factory 2 (Cleveland):');
  console.log(`  - Machine:  GB-999 (ID: ${machineGB999._id})`);
  console.log('  - Detroit users attempting to access GB-999 will receive 404 Not Found.');
  console.log('============================================================\n');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[Seed] Fatal error:', err);
  process.exit(1);
});
