import { Router } from 'express';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { authenticate } from '../middleware/authenticate.js';
import { env } from '../config/env.js';

const router = Router();

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * POST /api/auth/login
 * Authenticates user credentials, creates a server-side session,
 * sets an HttpOnly cookie for web browsers, and returns a sessionToken for mobile.
 */
router.post('/login', async (req, res) => {
  try {
    const rawIdentifier = req.body.emailOrUsername || req.body.email || req.body.username;
    const { password } = req.body;

    if (!rawIdentifier || !password) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Both email/username and password are required.'
      });
    }

    const identifier = rawIdentifier.trim().toLowerCase();

    // Query user by email or username, explicitly selecting passwordHash
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }]
    })
      .select('+passwordHash')
      .populate('factoryId', 'name code location')
      .populate('organizationId', 'name code')
      .populate('assignedSites', 'name code')
      .populate('assignedMachines', 'code name status');

    // Generic error to avoid user enumeration
    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid credentials.'
      });
    }

    const isMatch = await user.verifyPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid credentials.'
      });
    }

    // Generate high-entropy session token
    const rawToken = Session.generateToken();
    const tokenHash = Session.hashToken(rawToken);

    // Persist session to MongoDB
    await Session.create({
      tokenHash,
      userId: user._id,
      role: user.role,
      factoryId: user.factoryId._id || user.factoryId,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS)
    });

    // Set secure HttpOnly cookie for web clients
    res.cookie('pm_session', rawToken, {
      httpOnly: true,
      secure: env.isProd,
      sameSite: 'lax',
      maxAge: SESSION_DURATION_MS,
      path: '/'
    });

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      sessionToken: rawToken, // Provided for Expo SecureStore on mobile
      user: user.toJSON()
    });
  } catch (err) {
    console.error('[AuthRoute:Login] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'An error occurred during authentication.'
    });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user and active factory scope.
 */
router.get('/me', authenticate, async (req, res) => {
  return res.status(200).json({
    user: req.user.toJSON(),
    session: {
      id: req.session._id,
      expiresAt: req.session.expiresAt,
      createdAt: req.session.createdAt
    }
  });
});

/**
 * POST /api/auth/logout
 * Immediately revokes the server-side session and clears the browser cookie.
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Revoke the session record in MongoDB
    req.session.revokedAt = new Date();
    await req.session.save();

    // Clear client cookie
    res.clearCookie('pm_session', { path: '/' });

    return res.status(200).json({
      success: true,
      message: 'Session successfully revoked. Logged out.'
    });
  } catch (err) {
    console.error('[AuthRoute:Logout] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to revoke session on logout.'
    });
  }
});

export default router;
