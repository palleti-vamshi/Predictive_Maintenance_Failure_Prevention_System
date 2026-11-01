import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  env.CORS_ORIGIN
].filter(Boolean);

/**
 * Authentication Middleware:
 * Verifies session credentials from either HttpOnly cookie (Web) or Bearer authorization header (Mobile/API).
 * Enforces server-side session validity, revocation status, expiration, and CSRF origin verification for web cookies.
 */
export async function authenticate(req, res, next) {
  try {
    let rawToken = null;
    let isCookieAuth = false;

    // 1. Check HttpOnly cookie (web client standard)
    if (req.cookies && req.cookies.pm_session) {
      rawToken = req.cookies.pm_session;
      isCookieAuth = true;
    }

    // 2. Fallback to Bearer token header (mobile / external client standard)
    if (!rawToken && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        rawToken = parts[1];
      }
    }

    if (!rawToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required. No active session token found.'
      });
    }

    // 3. For state-changing requests using cookie authentication, enforce Origin / CSRF check
    const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase());
    if (isCookieAuth && isStateChanging) {
      const origin = req.headers.origin;
      // If origin header is present, ensure it is in the allowed list
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Origin verification failed. Potential cross-site request forgery.'
        });
      }
    }

    // 4. Compute token hash and lookup non-revoked, non-expired session
    const tokenHash = Session.hashToken(rawToken);
    const session = await Session.findOne({
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!session) {
      // Clear invalid cookie from client
      if (isCookieAuth) {
        res.clearCookie('pm_session', { path: '/' });
      }
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Session is invalid, revoked, or expired.'
      });
    }

    // 5. Retrieve active user with associated factory and organization scopes
    const user = await User.findById(session.userId)
      .populate('factoryId', 'name code location')
      .populate('organizationId', 'name code')
      .populate('assignedSites', 'name code')
      .populate('assignedMachines', 'code name status');

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User account is inactive or no longer exists.'
      });
    }

    // Attach user and session to request context
    req.user = user;
    req.session = session;
    req.rawToken = rawToken;

    next();
  } catch (err) {
    console.error('[AuthMiddleware] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to verify authentication credentials.'
    });
  }
}

