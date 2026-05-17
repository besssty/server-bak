/**
 * Application-сервіс: sessionService.
 *
 * Цей модуль координує навчальну сесію: перевіряє доступ користувача до паку,
 * створює персональні UserCard для нових карток, викликає domain-алгоритм
 * SM-2 після відповіді та очищає кеш залежних даних. Тут немає HTTP-деталей:
 * router тільки валідовує запит і делегує роботу цим сценаріям.
 */

import { ApplicationError } from '../../../shared/application/errors'
import { cacheDel, cacheDelPattern } from '../../../shared/utils/redis'
import { calculateSM2, SM_INITIAL_STATE } from '../domain/sm2Service'
import { sessionRepository } from '../infrastructure/sessionRepository'

// ── Типи сценаріїв використання ──────────────────────────────

interface StartSessionResult {
	sessionCards: SessionCardDto[]
}

interface SessionCardDto {
	userCardId: string
	question: string
	answer: string
}

interface SubmitAnswerResult {
	success: true
}

// ── Сценарій: startStudySession ──────────────────────────────

/**
 * startStudySession — ініціалізує навчальну сесію для паку.
 *
 * Простими словами: ця функція готує список карток, які користувач має
 * побачити в поточній навчальній сесії.
 *
 * Вона не перевіряє HTTP-запит напряму і не працює з Express. Router передає
 * сюди вже готові userId і packId, а service вирішує бізнес-задачу:
 * "чи можна цьому користувачу вчити цей пак і які картки зараз показати?".
 *
 * Основний сценарій:
 *  1. Перевіряє, що пак належить поточному користувачу.
 *  2. Завантажує всі картки паку у стабільному порядку.
 *  3. Для нових карток створює UserCard зі стандартним SM-2 станом.
 *  4. Відбирає тільки due-картки, тобто ті, які вже можна повторювати.
 *  5. Повертає DTO без зайвих Prisma-полів, зручний для фронтенду.
 *
 * Важливо розуміти різницю:
 *  - Card — це сама картка в паку: питання, відповідь, порядок;
 *  - UserCard — це персональний прогрес конкретного користувача по Card:
 *    коли повторювати, скільки було успішних повторень, чи вивчена картка.
 *
 * Важливий нюанс: дата today ставиться на кінець дня. Завдяки цьому картки
 * з nextReviewDate на сьогодні потрапляють у сесію незалежно від поточного
 * часу доби.
 *
 * @throws ApplicationError якщо пак не існує або користувач не має доступу.
 */
export async function startStudySession(
	userId: string,
	packId: string,
): Promise<StartSessionResult> {
	// Спочатку перевіряємо, що пак справді належить цьому користувачу.
	const pack = await sessionRepository.findPackOwned(packId, userId)

	if (!pack) {
		throw new ApplicationError('Пакет не знайдено або доступ заборонено', 'not_found')
	}

	// Завантажуємо всі Card цього паку. 
	const cards = await sessionRepository.findCardsByPack(packId)

	// today — межа, з якою порівнюємо nextReviewDate. Ставимо час  на кінець поточного дня. 
	const today = new Date()
	today.setHours(23, 59, 59, 999)

	// CardResult — допоміжний TypeScript-тип. Він означає "один елемент з масиву cards". 
	type CardResult = (typeof cards)[number]

	// Шукаємо UserCard для всіх карток паку. Якщо UserCard вже існує, значить користувач раніше починав цю картку, і в ній уже є SM-2 прогрес.
	const existingUserCards = await sessionRepository.findUserCardsForCards(
		userId,
		cards.map((card: CardResult) => card.id),
	)

	// Set потрібен для швидкої перевірки "чи вже є UserCard для цієї Card".
	const existingCardIds = new Set(existingUserCards.map(userCard => userCard.cardId))

	// newCards — це картки, для яких користувач ще не має персонального прогресу.
	const newCards = cards.filter((c: CardResult) => !existingCardIds.has(c.id))

	if (newCards.length > 0) {
		// Створюємо UserCard для нових карток.
		//
		// SM_INITIAL_STATE — початковий SM-2 стан:
		//  - repetition = 0, бо картку ще не повторювали;
		//  - interval = 0, бо реальний інтервал з'явиться після першої відповіді;
		//  - easeFactor = 2.5, стандартний стартовий коефіцієнт;
		//  - isLearned = false, бо картка ще не вивчена.
		await sessionRepository.createUserCards({
			userId,
			cardIds: newCards.map((card: CardResult) => card.id),
			initialState: SM_INITIAL_STATE,

			// Нові картки мають бути доступні одразу. Тому nextReviewDate ставимо на поточний момент, і нижче вони пройдуть перевірку due.
			nextReviewDate: new Date(),
		})
	}

	// Після createUserCards читаємо UserCard ще раз.
	// Це потрібно, бо createMany не повертає створені записи з id. А фронтенду потрібен userCardId, щоб потім відправити відповідь саме по цій UserCard.
	const userCards = await sessionRepository.findUserCardsForCards(
		userId,
		cards.map((card: CardResult) => card.id),
	)

	// UserCardItem — тип одного елемента з масиву userCards.
	type UserCardItem = (typeof userCards)[number]

	// До сесії потрапляють тільки due-картки.
	//
	// Due-картка — це картка, яку вже треба показати користувачу:
	//  - nextReviewDate у минулому;
	//  - або nextReviewDate сьогодні;
	//  - або це нова картка, яку ми щойно створили з nextReviewDate = new Date().
	const dueUserCards = userCards.filter((uc: UserCardItem) => new Date(uc.nextReviewDate) <= today)

	// Card і UserCard лежать у різних таблицях:
	//  - у Card є question і answer;
	//  - у UserCard є id персонального прогресу і cardId.
	//
	// cardMap дозволяє швидко знайти Card за cardId без додаткових запитів до бази. Це зручно при формуванні DTO нижче.
	const cardMap = new Map<string, CardResult>(cards.map((c: CardResult) => [c.id, c]))

	// Формуємо DTO для фронтенду.
	//
	// Фронтенду не потрібні всі поля з БД. Для показу картки в сесії достатньо:
	//  - userCardId, щоб потім відправити відповідь саме на цю UserCard;
	//  - question, щоб показати питання;
	//  - answer, щоб після відповіді можна було показати правильний варіант.
	const sessionCards: SessionCardDto[] = dueUserCards.map((uc: UserCardItem) => ({
		userCardId: uc.id,
		question: cardMap.get(uc.cardId)!.question,
		answer: cardMap.get(uc.cardId)!.answer,
	}))

	// Повертаємо об'єкт у форматі масиву. 
	return { sessionCards }
}

// ── Сценарій: submitAnswer ───────────────────────────────────

/**
 * submitAnswer — приймає відповідь користувача та фіксує результат повторення.
 *
 * Послідовність важлива:
 *  1. Знаходимо UserCard тільки в межах поточного користувача.
 *  2. Розраховуємо новий SM-2 стан чистою domain-функцією.
 *  3. Однією транзакцією оновлюємо прогрес, створюємо Review і DailyStat.
 *  4. Очищаємо кеш паку та статистики, бо прогрес змінився.
 *
 * Клієнт сам керує локальною чергою після успішного запису відповіді.
 */
export async function submitAnswer(
	userId: string,
	userCardId: string,
	quality: number,
): Promise<SubmitAnswerResult> {
	// Запит через userId не дозволяє відповісти за чужу UserCard навіть якщо
	// хтось підставить валідний userCardId з іншого акаунта.
	const userCard = await sessionRepository.findUserCardForAnswer(userId, userCardId)

	if (!userCard) {
		throw new ApplicationError('UserCard не знайдено', 'not_found')
	}

	// Domain-функція працює тільки з числовим станом картки. Усі побічні ефекти
	// нижче залишаються в application/infrastructure шарах.
	const sm2Result = calculateSM2(
		{
			repetition: userCard.repetition,
			interval: userCard.interval,
			easeFactor: userCard.easeFactor,
		},
		quality,
	)

	const todayStart = new Date()
	todayStart.setHours(0, 0, 0, 0)

	// recordAnswer всередині repository виконує транзакцію, щоб прогрес,
	// історія відповіді та денна статистика не розійшлися між собою.
	await sessionRepository.recordAnswer({
		userId,
		userCardId,
		cardId: userCard.cardId,
		quality,
		todayStart,
		sm2Result,
	})

	// Після відповіді змінюються і дані конкретного паку, і агрегована
	// статистика користувача. Кеш видаляється після успішного запису в БД.
	const packId = userCard.card.packId
	await cacheDel(`pack:${packId}:user:${userId}`)
	await cacheDelPattern(`stats:user:${userId}:*`)

	return { success: true }
}
