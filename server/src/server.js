import { createApp } from './app.js';
import { initDb, closeDb } from './database/db.js';
import { shipments } from './database/repositories.js';
import { seedDemo } from './services/seedService.js';
import { config } from './utils/config.js';
import { logger, serializeError } from './utils/logger.js';

try {
  initDb();
  if (config.seedOnBoot && shipments.count() === 0) await seedDemo();
} catch (err) {
  logger.error({ operation: 'startup', result: 'error', error: serializeError(err) });
  process.exit(1);
}

const server = createApp().listen(config.port, () =>
  logger.info({ operation: 'startup', result: 'listening', port: config.port, db: config.dbPath, aiConfigured: Boolean(config.ai.apiKey) }));

const shutdown = (sig) => { logger.info({ operation: 'shutdown', result: sig }); server.close(() => { closeDb(); process.exit(0); }); };
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ operation: 'unhandledRejection', result: 'error', error: serializeError(err) }));
