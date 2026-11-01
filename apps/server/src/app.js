import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import './models/index.js'; // Ensure all Mongoose schemas are registered
import { env } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import machineRoutes from './routes/machine.routes.js';
import adminRoutes from './routes/admin.routes.js';

const app = express();

// Allowed origins for CORS with credentials
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  env.CORS_ORIGIN
].filter(Boolean);

// CORS configuration (no wildcard credentialed CORS)
app.use(cors({
  origin: (origin, callback) => {
    // Requests with no origin (e.g. mobile apps via fetch, curl, native HTTP) are allowed
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true
}));

// Body & Cookie Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Development request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (env.isDev && !req.path.includes('/health') && !req.path.includes('/liveness')) {
      console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    }
  });
  next();
});

// Root API information
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'AI-Based Predictive Maintenance and Failure Prevention System API',
    initialMachine: 'Gearbox',
    version: '0.1.0',
    phase: 'Phase 3 - Authentication & Scoped Access Control',
    docs: {
      health: '/api/health',
      liveness: '/api/liveness',
      auth: {
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        logout: 'POST /api/auth/logout'
      },
      machines: 'GET /api/machines',
      admin: 'GET /api/admin/factory-users'
    }
  });
});

// Protected & Core API Routes
app.use('/api/auth', authRoutes);
app.use('/api/machines', machineRoutes);
app.use('/api/admin', adminRoutes);

// Health & Liveness Probes (Public)
app.use('/api', healthRoutes);
app.use('/', healthRoutes);

// 404 Not Found Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: `Resource ${req.method} ${req.path} not found.`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[ServerError]', err);
  res.status(err.status || 500).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred.'
  });
});

export default app;
