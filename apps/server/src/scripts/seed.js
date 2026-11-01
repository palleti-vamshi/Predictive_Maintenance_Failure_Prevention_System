import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Organization } from '../models/Organization.js';
import { Factory } from '../models/Factory.js';
import { Site } from '../models/Site.js';
import { Machine } from '../models/Machine.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { USER_ROLES, MACHINE_TYPES, SIGNAL_CATEGORIES } from '@predictive-maintenance/shared';

// Development demo passwords (overridable via environment variables)
const DEMO_MANAGER_PW = process.env.DEMO_MANAGER_PASSWORD || 'Manager123!';
const DEMO_TECH_PW = process.env.DEMO_TECH_PASSWORD || 'Tech123!';
const DEMO_VIEWER_PW = process.env.DEMO_VIEWER_PASSWORD || 'Viewer123!';

async function seed() {
  // Strict production lockout: demo accounts and sample telemetry must NEVER be seeded in production
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
    Session.deleteMany({})
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
    code: 'EXTR_L4'
  });

  const siteBayB = await Site.create({
    factoryId: factoryDetroit._id,
    name: 'Utility Bay B',
    code: 'UTIL_BAY_B'
  });

  // 4. Create Machines in Factory 1
  console.log('[Seed] Creating Gearbox Specimens in Detroit...');
  const machineGB104 = await Machine.create({
    factoryId: factoryDetroit._id,
    siteId: siteLine4._id,
    code: 'GB-104',
    name: 'Main Extruder Drive Gearbox',
    type: MACHINE_TYPES.GEARBOX,
    manufacturer: 'Siemens / Flender Helical-Planetary',
    model: 'B3SH-10',
    status: 'warning',
    gearRatio: '14.2:1',
    ratedSpeedRpm: 1780,
    ratedTorqueNm: 480,
    lubricantType: 'ISO VG 220 Synthetic',
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
    ],
    notes: [
      {
        author: 'Alex Mercer (technician)',
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
    status: 'healthy',
    gearRatio: '9.8:1',
    ratedSpeedRpm: 1450,
    ratedTorqueNm: 310,
    lubricantType: 'ISO VG 150 Mineral',
    stages: [
      { stage: 1, type: 'Bevel Stage', ratio: '2.5:1', condition: 'Nominal [DEMO]' },
      { stage: 2, type: 'Helical Stage', ratio: '3.92:1', condition: 'Nominal [DEMO]' }
    ],
    monitoredSignals: [
      { key: 'vibration_input_radial', label: 'Vibration Input Shaft (Radial)', unit: 'mm/s', category: SIGNAL_CATEGORIES.VIBRATION },
      { key: 'temp_gearbox_sump', label: 'Oil Sump Temperature', unit: '°C', category: SIGNAL_CATEGORIES.THERMAL },
      { key: 'rotational_speed', label: 'Shaft Speed', unit: 'RPM', category: SIGNAL_CATEGORIES.OPERATING_REGIME }
    ],
    notes: []
  });

  // 5. Create Users in Factory 1
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
    assignedSites: [siteLine4._id, siteBayB._id],
    assignedMachines: [machineGB104._id, machineGB201._id]
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
    assignedMachines: [machineGB104._id] // Assigned to GB-104 ONLY!
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
    assignedMachines: [machineGB104._id, machineGB201._id]
  });

  // 6. Create Factory 2 (Cleveland Plant #1) for Cross-Factory Scoping Tests
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
    status: 'healthy',
    gearRatio: '8.4:1',
    ratedSpeedRpm: 2400,
    ratedTorqueNm: 600,
    stages: [],
    monitoredSignals: []
  });

  await User.create({
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
  console.log('     - Scope:    Full access to Detroit Plant (GB-104, GB-201, Users)');
  console.log('  2. Technician:');
  console.log('     - Email:    tech@detroit.factory');
  console.log('     - Username: tech_detroit');
  console.log(`     - Password: ${DEMO_TECH_PW}`);
  console.log('     - Scope:    Assigned to GB-104 only; write notes; no user admin');
  console.log('  3. Viewer:');
  console.log('     - Email:    viewer@detroit.factory');
  console.log('     - Username: viewer_detroit');
  console.log(`     - Password: ${DEMO_VIEWER_PW}`);
  console.log('     - Scope:    Read-only assigned equipment; cannot post notes');
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

