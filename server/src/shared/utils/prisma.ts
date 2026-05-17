/** Utility-файл: prisma. */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

// Приводимо globalThis до типу що має наше кастомне поле.
// Це стандартний паттерн для TypeScript — globalThis типово є Record<string, unknown>.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Nullish coalescing: якщо глобальний екземпляр вже є — беремо його,
// якщо ні — створюємо новий. Так гарантуємо одне з'єднання.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('[Startup] Missing required environment variable: DATABASE_URL');
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Записуємо екземпляр у globalThis тільки НЕ в production.
// В production singleton не потрібен (немає hot reload), а зберігання
// в global збільшує споживання пам'яті.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
