/** Infrastructure-файл: statsRepository. */

import { prisma } from '../../../shared/utils/prisma';

function activeLearningPackWhere(userId: string) {
  return {
    createdById: userId,
    generatedMaterial: { is: { ownerId: userId } },
  };
}

export const statsRepository = {
  countCardsInUserPacks(userId: string) {
    return prisma.card.count({ where: { pack: activeLearningPackWhere(userId) } });
  },

  countDueCards(userId: string, todayEnd: Date) {
    return prisma.userCard.count({
      where: {
        userId,
        nextReviewDate: { lte: todayEnd },
        card: { pack: activeLearningPackWhere(userId) },
      },
    });
  },

  findTodayStat(userId: string, todayStart: Date, todayEnd: Date) {
    return prisma.dailyStat.findFirst({
      where: { userId, date: { gte: todayStart, lte: todayEnd } },
      select: { reviewCount: true },
    });
  },

  findUserPacksWithCardCount(userId: string) {
    return prisma.pack.findMany({
      where: activeLearningPackWhere(userId),
      select: {
        id:          true,
        title:       true,
        description: true,
        _count: { select: { cards: true } },
      },
    });
  },

  findUserCardsForUserPacks(userId: string) {
    return prisma.userCard.findMany({
      where: { userId, card: { pack: activeLearningPackWhere(userId) } },
      select: {
        nextReviewDate: true,
        card:           { select: { packId: true } },
      },
    });
  },

  findRecentReviewsWithPack(userId: string, since: Date) {
    return prisma.review.findMany({
      where: {
        userId,
        reviewedAt: { gte: since },
        card:       { pack: activeLearningPackWhere(userId) },
      },
      select: {
        quality: true,
        card: {
          select: {
            pack: {
              select: { id: true },
            },
          },
        },
      },
    });
  },
};
