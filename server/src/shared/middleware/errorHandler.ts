/** Middleware: errorHandler. */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ApplicationError, type ApplicationErrorKind } from '../application/errors';

const APPLICATION_ERROR_STATUS: Record<ApplicationErrorKind, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unprocessable: 422,
  external: 502,
};

/**
 * Express 4.x не ловить rejected Promises автоматично.
 * Без цієї обгортки будь-який `throw` або rejected `await` у route handler-і
 * призводить до UnhandledPromiseRejection і потенційного краша сервера.
 *
 * Приклад: якщо prisma.findUnique() кинула DB помилку — вона потрапить
 * в globalErrorHandler і клієнт отримає чіткий 500, а не зависання.
 *
 * @param fn  Асинхронний Express route handler
 * @returns   Синхронна обгортка, що передає помилки в next()
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Обертаємо Promise.resolve щоб перехопити і синхронні і асинхронні помилки
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 *
 * globalErrorHandler обробляє:
 *  1. ApplicationError → клієнтський HTTP status за kind
 *  2. Multer/body-parser помилки → 400/413 некоректний запит
 *  3. Будь-яка інша помилка → 500 внутрішня помилка сервера
 *
 * У production не розкриваємо деталі помилки клієнту з міркувань безпеки.
 * У development — показуємо stack trace для відлагодження.
 *
 * ВАЖЛИВО: Має 4 аргументи — Express розпізнає error middleware саме по підпису (err, req, res, next).
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Логуємо помилку на сервері завжди (для моніторингу)
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);

  // Якщо відповідь вже розпочата — нічого не робимо (headers вже надіслані)
  if (res.headersSent) {
    return;
  }

  if (err instanceof ApplicationError) {
    res.status(APPLICATION_ERROR_STATUS[err.kind]).json({ error: err.message });
    return;
  }

  // ── Обробка multer помилок (FileTypeError, FileSizeError) ─────
  if (err.message?.includes('Дозволені тільки PDF') || err.message?.includes('File too large')) {
    res.status(400).json({ error: err.message });
    return;
  }

  if ((err as Error & { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'Тіло запиту занадто велике' });
    return;
  }

  // ── Fallback: невідома помилка → 500 ─────────────────────────
  const isDev = process.env.NODE_ENV === 'development';
  res.status(500).json({
    error: 'Внутрішня помилка сервера',
    // У dev режимі показуємо деталі для зручності відлагодження
    ...(isDev ? { details: err.message, stack: err.stack } : {}),
  });
}
