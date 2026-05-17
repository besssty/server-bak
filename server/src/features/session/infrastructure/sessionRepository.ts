/** Infrastructure-файл: sessionRepository. */

import { prisma } from '../../../shared/utils/prisma'
import type { SM2Result } from '../domain/sm2Service'

interface InitialUserCardState {
	repetition: number
	interval: number
	easeFactor: number
	isLearned: boolean
}

export const sessionRepository = {
	// Сесія може стартувати тільки для паку поточного користувача.
	findPackOwned(packId: string, userId: string) {
		return prisma.pack.findFirst({
			where: {
				id: packId,
				createdById: userId,
				generatedMaterial: { is: { ownerId: userId } },
			},
			select: { id: true },
		})
	},

	// Порядок карток важливий для стабільного навчального сценарію.
	findCardsByPack(packId: string) {
		return prisma.card.findMany({
			where: { packId },
			orderBy: { order: 'asc' },
		})
	},

	findUserCardsForCards(userId: string, cardIds: string[]) {
		return prisma.userCard.findMany({
			where: { userId, cardId: { in: cardIds } },
		})
	},

	createUserCards(params: {
		userId: string
		cardIds: string[]
		initialState: InitialUserCardState
		nextReviewDate: Date
	}) {
		// skipDuplicates захищає від повторного старту сесії в паралельних запитах.
		return prisma.userCard.createMany({
			data: params.cardIds.map(cardId => ({
				userId: params.userId,
				cardId,
				...params.initialState,
				nextReviewDate: params.nextReviewDate,
			})),
			skipDuplicates: true,
		})
	},

	// Для відповіді потрібен і персональний стан UserCard, і packId зв'язаної Card.
	findUserCardForAnswer(userId: string, userCardId: string) {
		return prisma.userCard.findFirst({
			where: { id: userCardId, userId },
			include: { card: true },
		})
	},

	recordAnswer(params: {
		userId: string
		userCardId: string
		cardId: string
		quality: number
		todayStart: Date
		sm2Result: SM2Result
	}) {
		// Оновлення прогресу, історії повторення і щоденної статистики має бути атомарним.
		return prisma.$transaction([
			prisma.userCard.update({
				where: { id: params.userCardId },
				data: {
					repetition: params.sm2Result.repetition,
					interval: params.sm2Result.interval,
					easeFactor: params.sm2Result.easeFactor,
					nextReviewDate: params.sm2Result.nextReviewDate,
					isLearned: params.sm2Result.isLearned,
				},
			}),
			prisma.review.create({
				data: {
					userId: params.userId,
					cardId: params.cardId,
					quality: params.quality,
				},
			}),
			prisma.dailyStat.upsert({
				where: { userId_date: { userId: params.userId, date: params.todayStart } },
				create: {
					userId: params.userId,
					date: params.todayStart,
					reviewCount: 1,
					correctCount: params.quality >= 2 ? 1 : 0,
				},
				update: {
					reviewCount: { increment: 1 },
					correctCount: { increment: params.quality >= 2 ? 1 : 0 },
				},
			}),
		])
	},
}
