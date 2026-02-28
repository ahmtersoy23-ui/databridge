import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { checkConnections, closePools } from './config/database';
import { startScheduler, stopScheduler } from './services/sync/scheduler';
import logger from './config/logger';

const PORT = parseInt(process.env.PORT || '3008');

async function startServer(): Promise<void> {
  // Verify database connections
  await checkConnections();

  const app = createApp();

  app.listen(PORT, () => {
    logger.info(`DataBridge server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start sync scheduler
    startScheduler();
  });
}

// Graceful shutdown
function shutdown(signal: string): void {
  logger.info(`${signal} received. Shutting down gracefully...`);
  stopScheduler();
  closePools()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer().catch(err => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
