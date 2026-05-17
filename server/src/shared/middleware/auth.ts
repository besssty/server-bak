/** Middleware: requireAuth. */

import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken } from '../utils/jwt'

/**
 * Розширений тип Express Request.
 */
export interface AuthRequest extends Request {
	user?: { id: string; email: string; username: string; createdAt: Date }
}

/**
 * requireAuth — middleware що захищає endpoint від неавторизованих запитів.
 *
 *  Верифікація відбувається криптографічно (jwt.verify).
 *  req.user заповнюється даними з JWT payload.
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
	const authHeader = req.headers.authorization

	// Перевіряємо наявність і формат заголовка "Bearer <token>"
	if (!authHeader?.startsWith('Bearer ')) {
		res.status(401).json({ error: 'Необхідна авторизація' })
		return
	}

	// Витягуємо токен (частина після "Bearer ")
	const token = authHeader.split(' ')[1]

	// verifyAccessToken повертає повний UserPayload з email/username,
	const payload = verifyAccessToken(token)

	if (!payload) {
		res.status(401).json({ error: 'Невалідний або прострочений токен' })
		return
	}

	// Заповнюємо req.user з JWT payload. Дані підписані сервером і гарантовано автентичні на момент видачі токена.
	// createdAt конвертуємо з Unix timestamp (число секунд) у Date об'єкт.
	req.user = {
		id: payload.userId, email: payload.email, username: payload.username, createdAt: new Date(payload.createdAt),
	}

	next()
}
