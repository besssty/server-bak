/** Application-сервіс: statsService. */

import { cacheGet, cacheSet } from '../../../shared/utils/redis'
import { calculateAnswerRetentionRate } from '../domain/statsDomain'
import { statsRepository } from '../infrastructure/statsRepository'

const SUMMARY_TTL = 10 * 60;
// Поріг для Focus Pack: у список потрапляють паки з retention rate нижче 90%.
const LOW_RETENTION_THRESHOLD = 90;

export async function getStatsSummary(userId: string) {
  const cacheKey = `stats:user:${userId}:summary:v5`;
  const cached = await cacheGet(cacheKey);

  if (cached) return cached;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const last30 = new Date();
  last30.setHours(0, 0, 0, 0);
  last30.setDate(last30.getDate() - 30);

  const [
    totalCards,
    dueToday,
    todayStat,
    userPacks,
    userCards,
    recentReviews,
  ] = await Promise.all([
    statsRepository.countCardsInUserPacks(userId),
    statsRepository.countDueCards(userId, todayEnd),
    statsRepository.findTodayStat(userId, todayStart, todayEnd),
    statsRepository.findUserPacksWithCardCount(userId),
    statsRepository.findUserCardsForUserPacks(userId),
    statsRepository.findRecentReviewsWithPack(userId, last30),
  ]);

  const packStats = new Map(userPacks.map((pack) => [
    pack.id,
    {
      packId:        pack.id,
      title:         pack.title,
      description:   pack.description,
      totalCards:    pack._count.cards,
      dueCount:      0,
      userCardCount: 0,
      retentionRate: null as number | null,
    },
  ]));

  for (const userCard of userCards) {
    const stat = packStats.get(userCard.card.packId);
    if (!stat) continue;

    stat.userCardCount += 1;
    if (new Date(userCard.nextReviewDate) <= todayEnd) stat.dueCount += 1;
  }

  // Групуємо повторення за паками, щоб окремо порахувати retention rate для кожного паку.
  const reviewStatsByPack = new Map<string, { reviewCount: number; correctCount: number }>();

  for (const review of recentReviews) {
    const packId = review.card.pack.id;
    const packReviewStats = reviewStatsByPack.get(packId) ?? { reviewCount: 0, correctCount: 0 };
    packReviewStats.reviewCount += 1;

    if (review.quality >= 2) packReviewStats.correctCount += 1;
    reviewStatsByPack.set(packId, packReviewStats);
  }

  for (const [packId, reviewStats] of reviewStatsByPack) {
    const stat = packStats.get(packId);
    if (!stat || reviewStats.reviewCount === 0) continue;

    stat.retentionRate = calculateAnswerRetentionRate([reviewStats]);
  }

  // Додаємо availableDueCount: він показує, скільки карток можна повторити в паку.
  // Якщо користувач ще не починав пак, але в ньому є картки, доступним вважається весь пак.
  const packsWithAvailability = Array.from(packStats.values()).map((pack) => ({
    ...pack,
    availableDueCount: pack.dueCount > 0
      ? pack.dueCount
      : pack.userCardCount === 0 && pack.totalCards > 0
        ? pack.totalCards
        : 0,
  }));

  const duePacks = packsWithAvailability
    .filter((pack) => pack.availableDueCount > 0)
    .sort((a, b) =>
      b.availableDueCount - a.availableDueCount
      || (a.retentionRate ?? 100) - (b.retentionRate ?? 100)
      || a.title.localeCompare(b.title)
    )
    .map((pack) => ({
      packId:      pack.packId,
      title:       pack.title,
      description: pack.description,
      totalCards:  pack.totalCards,
      dueCount:    pack.availableDueCount,
    }));

  // Focus Pack показує тільки ті паки, які доступні до повторення і мають слабкий retention rate.
  const focusPacks = packsWithAvailability.filter((pack) =>
      pack.availableDueCount > 0
      && pack.retentionRate !== null
      && pack.retentionRate < LOW_RETENTION_THRESHOLD
    )
    // Найнижчий retention rate йде першим, щоб користувач одразу бачив найпроблемніший пак.
    .sort((a, b) =>
      (a.retentionRate ?? 100) - (b.retentionRate ?? 100)
      || b.availableDueCount - a.availableDueCount
      || b.totalCards - a.totalCards
      || a.title.localeCompare(b.title)
    )
    .map((pack) => ({
      packId:        pack.packId,
      title:         pack.title,
      description:   pack.description,
      totalCards:    pack.totalCards,
      dueCount:      pack.availableDueCount,
      retentionRate: pack.retentionRate,
    }));

  const response = {
    totalCards,
    reviewsToday: todayStat?.reviewCount ?? 0,
    dueToday,
    duePacks,
    focusPacks,
  };

  await cacheSet(cacheKey, response, SUMMARY_TTL);
  return response;
}
