import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/database.js';

async function bootstrap() {
  console.log('------------------------------------------------------------');
  console.log('AI-Based Predictive Maintenance and Failure Prevention System');
  console.log(`Phase 1 Backend - Starting in ${env.NODE_ENV} mode...`);
  console.log('------------------------------------------------------------');

  // Attempt non-blocking DB connection
  connectDB().catch((err) => {
    console.error('[Database] Unexpected connection error:', err);
  });

  const server = app.listen(env.PORT, () => {
    console.log(`[Server] Express API listening on http://localhost:${env.PORT}`);
    console.log(`[Server] Health check endpoint: http://localhost:${env.PORT}/api/health`);
    console.log(`[Server] Liveness endpoint:     http://localhost:${env.PORT}/api/liveness`);
  });

  // Graceful shutdown handling
  const shutdown = (signal) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log('[Server] HTTP listener closed.');
      process.exit(0);
    });

    // Force exit after 5s if still closing
    setTimeout(() => {
      console.error('[Server] Forceful shutdown initiated after timeout.');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal startup failure:', err);
  process.exit(1);
});

