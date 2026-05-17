/** Express application composition. */

import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { authRouter } from './features/auth';
import { materialRouter } from './features/material';
import { sessionRouter } from './features/session';
import { statsRouter } from './features/stats';
import { corsOptions } from './config/cors';
import { globalErrorHandler } from './shared/middleware/errorHandler';

export function createApp() {
  const app = express();

  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));

  app.use(helmet());
  app.use(morgan('dev'));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use('/api/auth', authRouter);
  app.use('/api/session', sessionRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/materials', materialRouter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(globalErrorHandler);

  return app;
}
