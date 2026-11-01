/**
 * User roles and access scope definitions.
 * Enforced on the backend and scoped to organization, factory, site, and assigned machines.
 */
export const USER_ROLES = Object.freeze({
  FACTORY_MANAGER: 'factory_manager',
  TECHNICIAN: 'technician',
  VIEWER: 'viewer'
});

export const ACCESS_SCOPES = Object.freeze({
  ORGANIZATION: 'organization',
  FACTORY: 'factory',
  SITE: 'site',
  MACHINE: 'machine'
});

export const ROLE_DESCRIPTIONS = Object.freeze({
  [USER_ROLES.FACTORY_MANAGER]: 'Full management of users, sites, machines, datasets, alerts, and reports within their factory.',
  [USER_ROLES.TECHNICIAN]: 'Views assigned machines, uploads datasets, reviews warnings, acknowledges alerts, and adds maintenance notes.',
  [USER_ROLES.VIEWER]: 'Read-only access to assigned sites or machines.'
});

