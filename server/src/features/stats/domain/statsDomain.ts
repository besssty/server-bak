/** Domain-файл: statsDomain. */

/**
 * calculateAnswerRetentionRate — рахує відсоток правильних відповідей.
 *
 * Формула така сама, як у таблиці для Retention Rate:
 * правильні відповіді / всі відповіді * 100, після чого результат округлюється.
 */
export function calculateAnswerRetentionRate(
  stats: Array<{ reviewCount: number; correctCount: number }>
): number {
  const totalReviews = stats.reduce((sum, stat) => sum + stat.reviewCount, 0);
  if (totalReviews === 0) return 0;

  const totalCorrect = stats.reduce((sum, stat) => sum + stat.correctCount, 0);
  return Math.round((totalCorrect / totalReviews) * 100);
}
