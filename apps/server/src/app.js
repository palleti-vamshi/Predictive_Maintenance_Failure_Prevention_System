import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import './models/index.js'; // Ensure all Mongoose schemas are registered
import { env } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import machineRoutes from './routes/machine.routes.js';
import siteRoutes from './routes/site.routes.js';
import workOrderRoutes from './routes/workOrder.routes.js';
import datasetRoutes from './routes/dataset.routes.js';
import modelRoutes from './routes/model.routes.js';
import analysisRunRoutes from './routes/analysisRun.routes.js';
import alertRoutes from './routes/alert.routes.js';
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
    phase: 'Phase 7 - Verified Analysis Runs and Explainable Alerts',
    docs: {
      health: '/api/health',
      liveness: '/api/liveness',
      auth: {
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        logout: 'POST /api/auth/logout'
      },
      sites: 'GET /api/sites',
      machines: 'GET /api/machines',
      workOrders: 'GET /api/work-orders',
      datasets: {
        list: 'GET /api/datasets',
        referenceCatalog: 'GET /api/datasets/reference-catalog',
        upload: 'POST /api/datasets/upload',
        validate: 'POST /api/datasets/validate',
        confirm: 'POST /api/datasets/confirm'
      },
      models: {
        train: 'POST /api/models/train',
        list: 'GET /api/models',
        get: 'GET /api/models/:id',
        delete: 'DELETE /api/models/:id'
      },
      analysisRuns: {
        create: 'POST /api/analysis-runs',
        list: 'GET /api/analysis-runs',
        get: 'GET /api/analysis-runs/:id'
      },
      alerts: {
        list: 'GET /api/alerts',
        get: 'GET /api/alerts/:id',
        acknowledge: 'POST /api/alerts/:id/acknowledge',
        observations: 'POST /api/alerts/:id/observations',
        workOrder: 'POST /api/alerts/:id/work-order'
      },
      admin: 'GET /api/admin/factory-users'
    }
  });
});

// Protected & Core API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/machines', machineRoutes);
app.use('/api/work-orders', workOrderRoutes);
app.use('/api/datasets', datasetRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/analysis-runs', analysisRunRoutes);
app.use('/api/alerts', alertRoutes);
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
