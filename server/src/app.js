import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { config } from './utils/config.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST', 'PATCH'] })); // explicit allow-list, no wildcard
  app.use(express.json({ limit: '10kb' }));
  app.use(requestLogger);
  app.use('/api', routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
