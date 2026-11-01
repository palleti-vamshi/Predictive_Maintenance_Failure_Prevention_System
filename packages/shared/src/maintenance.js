/**
 * Shared definitions for maintenance work orders, machine commissioning,
 * and gearbox engineering specifications.
 */

export const WORK_ORDER_STATUS = Object.freeze({
  OPEN: 'open',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REVIEWED: 'reviewed'
});

export const WORK_ORDER_PRIORITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
});

export const OPERATIONAL_STATUS = Object.freeze({
  COMMISSIONED: 'commissioned',
  OPERATIONAL: 'operational',
  STANDBY: 'standby',
  UNDER_MAINTENANCE: 'under_maintenance',
  DECOMMISSIONED: 'decommissioned'
});

export const GEARBOX_ARRANGEMENTS = Object.freeze([
  'Helical-Planetary',
  'Bevel-Helical',
  'Single-Stage Planetary',
  'Multi-Stage Planetary',
  'Parallel Shaft Helical',
  'Worm-Gear',
  'Cycloidal'
]);

export const ISO_VG_GRADES = Object.freeze([
  'ISO VG 68',
  'ISO VG 100',
  'ISO VG 150',
  'ISO VG 220',
  'ISO VG 320',
  'ISO VG 460',
  'ISO VG 680'
]);
