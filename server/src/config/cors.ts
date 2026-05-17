/** CORS configuration for the HTTP API. */

import type { CorsOptions } from 'cors';
import { env } from './env';

const allowedOrigins = [
  env.clientUrl,
  'http://localhost:5173',
].filter(Boolean) as string[];

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
