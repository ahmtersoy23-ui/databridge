import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from './config/constants';

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(compression());
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : ['http://localhost:5173', 'http://localhost:3008'],
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));

  // Rate limiting
  app.use('/api/', rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    message: { success: false, error: 'Too many requests' },
  }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', app: 'databridge', timestamp: new Date().toISOString() });
  });

  // API routes
  app.use('/api/v1', routes);
  app.use('/api', routes); // backwards compat

  // Global error handler
  app.use(errorHandler);

  return app;
}
