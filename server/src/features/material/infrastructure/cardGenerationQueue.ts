/**
 * Infrastructure-файл: cardGenerationQueue
 *
 * Призначення:
 * Надає BullMQ queue і worker для фонової генерації карток з матеріалів.
 */

import { Queue, Worker, type Job } from 'bullmq';
import { ApplicationError } from '../../../shared/application/errors';

export interface CardGenerationJobData {
  userId: string;
  materialId: string;
}

export interface CardGenerationJobResult {
  pack: {
    id: string;
    title: string;
    cardCount: number;
  };
}

type CardGenerationJobName = 'generate-cards';
type CardGenerationProcessor = (
  data: CardGenerationJobData,
  job: Job<CardGenerationJobData, CardGenerationJobResult, CardGenerationJobName>
) => Promise<CardGenerationJobResult>;

const QUEUE_NAME = 'card-generation';
const JOB_NAME: CardGenerationJobName = 'generate-cards';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const WORKER_CONCURRENCY = Number(process.env.CARD_GENERATION_CONCURRENCY ?? 1);
const RATE_LIMIT_MAX = Number(process.env.CARD_GENERATION_RATE_LIMIT_MAX ?? 3);
const RATE_LIMIT_DURATION_MS = Number(process.env.CARD_GENERATION_RATE_LIMIT_DURATION_MS ?? 60_000);
const MAX_ACTIVE_OR_WAITING_JOBS = Number(process.env.CARD_GENERATION_QUEUE_LIMIT ?? 30);

const connection = {
  url: REDIS_URL,
  family: 0,
  maxRetriesPerRequest: null,
};

const cardGenerationQueue = new Queue<
  CardGenerationJobData,
  CardGenerationJobResult,
  CardGenerationJobName
>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 24 * 60 * 60, count: 100 },
    removeOnFail:     { age: 7 * 24 * 60 * 60, count: 200 },
  },
});

let worker: Worker<CardGenerationJobData, CardGenerationJobResult, CardGenerationJobName> | null = null;

function makeJobId(data: CardGenerationJobData): string {
  return `material-${data.materialId}-user-${data.userId}`;
}

async function ensureQueueHasCapacity(): Promise<void> {
  const counts = await cardGenerationQueue.getJobCounts('waiting', 'delayed', 'active', 'prioritized');
  const queued =
    (counts.waiting ?? 0) +
    (counts.delayed ?? 0) +
    (counts.active ?? 0) +
    (counts.prioritized ?? 0);

  if (queued >= MAX_ACTIVE_OR_WAITING_JOBS) {
    throw new ApplicationError(
      'Черга генерації зараз перевантажена. Спробуйте трохи пізніше.',
      'rate_limited'
    );
  }
}

export async function enqueueCardGenerationJob(data: CardGenerationJobData) {
  try {
    await ensureQueueHasCapacity();

    const job = await cardGenerationQueue.add(JOB_NAME, data, {
      jobId: makeJobId(data),
      sizeLimit: 2048,
    });

    return { jobId: String(job.id) };
  } catch (err) {
    if (err instanceof ApplicationError) throw err;
    console.error('[BullMQ] Failed to enqueue card generation job:', err);
    throw new ApplicationError('Черга генерації тимчасово недоступна. Спробуйте пізніше.', 'external');
  }
}

export function startCardGenerationWorker(processor: CardGenerationProcessor) {
  if (worker) return worker;

  worker = new Worker<CardGenerationJobData, CardGenerationJobResult, CardGenerationJobName>(
    QUEUE_NAME,
    (job) => processor(job.data, job),
    {
      connection,
      // Кількість паралельних задач обмежуємо env-параметром, але не даємо значенню впасти нижче 1.
      concurrency: Math.max(1, WORKER_CONCURRENCY),
      limiter: {
        // Rate limit захищає OpenAI API і Redis від різких піків генерації.
        max:      Math.max(1, RATE_LIMIT_MAX),
        duration: Math.max(1_000, RATE_LIMIT_DURATION_MS),
      },
      // Генерація може бути довгою, тому lock тримається довше за типовий короткий job.
      lockDuration:     10 * 60 * 1000,
      maxStalledCount:  1,
      removeOnComplete: { age: 24 * 60 * 60, count: 100 },
      removeOnFail:     { age: 7 * 24 * 60 * 60, count: 200 },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[BullMQ] Card generation completed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[BullMQ] Card generation failed: ${job?.id ?? 'unknown'}`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[BullMQ] Card generation worker error:', err.message);
  });

  console.log(
    `[BullMQ] Card generation worker started (concurrency=${Math.max(1, WORKER_CONCURRENCY)}, rate=${Math.max(1, RATE_LIMIT_MAX)}/${Math.max(1_000, RATE_LIMIT_DURATION_MS)}ms)`
  );

  return worker;
}
