/** Router: sessionRouter. */

import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, type AuthRequest } from '../../../shared/middleware/auth'
import { asyncHandler } from '../../../shared/middleware/errorHandler'
import { startStudySession, submitAnswer } from '../application/sessionService'

export const sessionRouter = Router()

// ── POST /api/session/start ───────────────────────────────────
sessionRouter.post(
	'/start',
	requireAuth,
	asyncHandler(async (req: AuthRequest, res) => {
		const schema = z.object({ packId: z.string() })
		const parsed = schema.safeParse(req.body)
		if (!parsed.success) {
			res.status(400).json({ error: "packId обов'язковий" })
			return
		}

		const userId = req.user!.id
		const { packId } = parsed.data

		const result = await startStudySession(userId, packId)
		res.json(result)
	}),
)

// ── POST /api/session/answer ──────────────────────────────────
sessionRouter.post(
	'/answer',
	requireAuth,
	asyncHandler(async (req: AuthRequest, res) => {
		const schema = z.object({
			userCardId: z.string(),
			quality: z.number().int().min(0).max(3),
		})

		const parsed = schema.safeParse(req.body)
		if (!parsed.success) {
			res.status(400).json({ error: 'Невалідні дані' })
			return
		}

		const userId = req.user!.id
		const { userCardId, quality } = parsed.data

		const result = await submitAnswer(userId, userCardId, quality)
		res.json(result)
	}),
)
