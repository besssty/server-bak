/** Middleware factory: createRateLimiter. */

import type { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;                 // Тривалість вікна, наприклад 60_000 мс.
  max: number;                      // Максимальна кількість запитів у межах вікна.
  keyPrefix: string;                // Простір ключів: auth:refresh, materials:upload тощо.
  keyFn?: (req: Request) => string; // Дає змогу рахувати за userId, а не тільки за IP.
}

interface Bucket {
  count: number;   // Скільки запитів уже було в поточному вікні.
  resetAt: number; // Unix timestamp у мс, коли bucket треба скинути.
}

// Глобальна Map для всіх створених limiter-ів у межах процесу.
const buckets = new Map<string, Bucket>();

export function createRateLimiter(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    // keyFn дозволяє endpoint-ам після requireAuth лімітувати за userId.
    // Якщо userId недоступний, падаємо назад на IP або "unknown".
    const rawKey = options.keyFn?.(req) ?? req.ip ?? 'unknown';
    const key = `${options.keyPrefix}:${rawKey}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      // Перше звернення або вікно вже минуло: створюємо новий лічильник.
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (bucket.count >= options.max) {
      // Вікно ще активне і ліміт вичерпано — повертаємо 429 без виклику обробника.
      res.status(429).json({ error: 'Забагато запитів. Спробуйте пізніше.' });
      return;
    }

    // Запит дозволено, збільшуємо лічильник у поточному вікні.
    bucket.count += 1;
    next();
  };
}
