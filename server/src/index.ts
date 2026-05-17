/** Application entry point. */

import 'dotenv/config';

import { createApp } from './app';
import { startServer } from './bootstrap/server';
import { env, validateRequiredEnv } from './config/env';
import { ensureMaterialUploadTmpDir } from './features/material/infrastructure/upload';

validateRequiredEnv();
ensureMaterialUploadTmpDir();

void startServer(createApp(), env.port);
