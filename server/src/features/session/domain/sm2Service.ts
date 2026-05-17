/**
 * Domain-файл: sm2Service.
 *
 * Тут зібрана чиста логіка інтервального повторення SM-2. Функції цього
 * модуля не звертаються до бази даних, Redis або HTTP-шару, тому їх легко
 * тестувати окремо і безпечно використовувати з різних application-сервісів.
 */

export interface SM2Input {
  repetition: number;
  interval:   number;
  easeFactor: number;
}

export interface SM2Result extends SM2Input {
  nextReviewDate: Date;
  isLearned:      boolean;
}

/**
 * SM_INITIAL_STATE — початковий SM-2 стан для нової картки.
 *
 * repetition = 0 означає, що користувач ще жодного разу успішно не
 * повторив картку. interval = 0 потрібен тільки як стартове значення:
 * реальна дата наступного повторення задається окремим nextReviewDate.
 * easeFactor = 2.5 — класичний стартовий коефіцієнт легкості для SM-2.
 *
 * Кожне місце виклику передає nextReviewDate: new Date() явно:
 *   prisma.userCard.create({
 *     data: { ...SM_INITIAL_STATE, nextReviewDate: new Date(), ... }
 *   })
 */
export const SM_INITIAL_STATE = {
  repetition: 0,
  interval:   0,
  easeFactor: 2.5,
  isLearned:  false,
} as const;

/**
 * calculateSM2 — розраховує новий стан картки після відповіді користувача.
 *
 * У застосунку використовується шкала quality від 0 до 3:
 *  - 0 або 1 — відповідь вважається невдалою, серія повторень скидається;
 *  - 2 або 3 — відповідь вважається успішною, інтервал збільшується.
 *
 * Алгоритм повертає тільки обчислений результат. Він не записує дані в БД
 * і не створює Review: ці побічні ефекти виконує sessionService після того,
 * як перевірить право доступу до UserCard.
 *
 * @param card Поточний SM-2 стан конкретної UserCard.
 * @param quality Оцінка відповіді користувача від 0 до 3.
 * @returns Нові repetition, interval, easeFactor, дата наступного повторення
 *          та прапорець isLearned для прогресу користувача.
 */
export function calculateSM2(card: SM2Input, quality: number): SM2Result {
  // Не дозволяємо easeFactor падати нижче 1.3, щоб картка не застрягла на надто коротких інтервалах після кількох складних відповідей.
  const MIN_EF = 1.3;

  let { repetition, interval, easeFactor } = card;

  if (quality >= 2) {
    // Перші два успішні повторення мають фіксовані інтервали. Це дає передбачуваний старт навчання перед переходом до множення на easeFactor.
    if (repetition === 0) {
      interval = 1;
    } else if (repetition === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetition += 1;
  } else {
    // Невдала відповідь повертає картку на початок серії, але залишає її доступною вже наступного дня, щоб користувач швидко закріпив матеріал.
    repetition = 0;
    interval   = 1;
  }

  // Формула SM-2 коригує коефіцієнт легкості: хороші відповіді його підвищують, слабкі — знижують. quality = 3 дає найбільший приріст, quality = 0/1 зменшує easeFactor, але не нижче MIN_EF.
  const efDelta = 0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02);
  easeFactor = Math.max(MIN_EF, easeFactor + efDelta);

  // Наступне повторення планується від поточної дати. Час скидається на початок дня, щоб порівняння due-карток не залежало від години відповіді.
  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);
  nextReviewDate.setHours(0, 0, 0, 0);

  // Картка вважається вивченою або після трьох успішних повторень, або коли інтервал уже достатньо довгий. Це впливає на статистику прогресу паку.
  const isLearned = repetition >= 3 || interval >= 30;

  return { repetition, interval, easeFactor, nextReviewDate, isLearned };
}
