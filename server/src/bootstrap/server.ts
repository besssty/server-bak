/** Server bootstrap: external connections and HTTP listener. */

import type { Express } from 'express';
import { processQueuedCardsGeneration } from '../features/material/application/materialService';
import { startCardGenerationWorker } from '../features/material/infrastructure/cardGenerationQueue';
import { connectRedis } from '../shared/utils/redis';

export async function startServer(app: Express, port: number): Promise<void> {
  const redisReady = await connectRedis();

  if (redisReady) {
    startCardGenerationWorker((data) => processQueuedCardsGeneration(data));
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}
