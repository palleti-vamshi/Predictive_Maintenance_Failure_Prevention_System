import { USER_ROLES } from '@predictive-maintenance/shared';

/**
 * Role-Based Access Control (RBAC) Middleware.
 * Enforces user role permissions strictly on the server.
 */
export function requireRole(...allowedRoles) {
  const flattenedRoles = allowedRoles.flat();

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required before evaluating role permissions.'
      });
    }

    if (!flattenedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient permissions. Operation requires role in: [${flattenedRoles.join(', ')}].`,
        userRole: req.user.role
      });
    }

    next();
  };
}

export const requireManager = requireRole(USER_ROLES.FACTORY_MANAGER);
export const requireTechnicianOrManager = requireRole(
  USER_ROLES.FACTORY_MANAGER,
  USER_ROLES.TECHNICIAN
);

