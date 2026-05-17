// У цьому файлі використовуються не тільки звичайні тести, а й моки.
// Мок - це "підробка" справжньої залежності. Тут ми підробляємо BullMQ,
// щоб тести не запускали реальний Redis і справжню чергу.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Це приклад даних, які в реальному застосунку потрапляють у задачу черги.
const jobData = { userId: 'user-1', materialId: 'material-1' }

// Запам'ятовуємо початкові змінні оточення.
// Після кожного тесту ми повернемо їх назад, щоб один тест не впливав на інший.
const savedEnv = { ...process.env }

// Для тестів задаємо прості й маленькі значення.
// Так легше перевірити, наприклад, що ліміт черги дорівнює 2.
const queueEnv = {
	REDIS_URL: 'redis://test-redis:6379',
	CARD_GENERATION_QUEUE_LIMIT: '2',
	CARD_GENERATION_CONCURRENCY: '2',
	CARD_GENERATION_RATE_LIMIT_MAX: '5',
	CARD_GENERATION_RATE_LIMIT_DURATION_MS: '2000',
}

// vi.hoisted потрібен через особливість vi.mock:
// Vitest піднімає vi.mock на початок файлу ще до запуску іншого коду.
// Тому все, що потрібно для моку, теж створюємо через vi.hoisted.
const bullmq = vi.hoisted(() => {
	// vi.fn() створює підроблену функцію.
	// Vitest запам'ятовує, чи її викликали, з якими аргументами,
	// і дозволяє вручну задати, що вона має повернути.
	const queue = { add: vi.fn(), getJobCounts: vi.fn() }
	const worker = { on: vi.fn() }

	// Тут ми збережемо функцію, яку код передасть у Worker.
	// Потім у тесті зможемо викликати її вручну, без справжнього worker-а.
	let processor: ((job: { data: typeof jobData }) => Promise<unknown>) | undefined

	return {
		queue,
		worker,
		// Це підробка Queue з BullMQ.
		// Коли код напише new Queue(...), тест отримає наш об'єкт queue.
		Queue: vi.fn(function QueueMock() {
			return queue
		}),
		// Це підробка Worker з BullMQ.
		// Вона не запускає реальну фонову роботу, а тільки запам'ятовує processor.
		Worker: vi.fn(function WorkerMock(_name: string, next: unknown) {
			processor = next as typeof processor
			return worker
		}),
		getProcessor: () => processor as (job: { data: typeof jobData }) => Promise<unknown>,
	}
})

// vi.mock каже Vitest: коли код імпортує bullmq, дай йому нашу підробку.
// Завдяки цьому тест швидкий, стабільний і не залежить від Redis.
vi.mock('bullmq', () => ({ Queue: bullmq.Queue, Worker: bullmq.Worker }))

const mockCounts = (counts = {}) =>
	// getJobCounts у реальному BullMQ повертає кількість задач у черзі.
	// Тут ми самі задаємо потрібні числа для конкретного тесту.
	bullmq.queue.getJobCounts.mockResolvedValue({
		waiting: 0,
		delayed: 0,
		active: 0,
		prioritized: 0,
		...counts,
	})

const loadQueueModule = async () => {
	// Модуль cardGenerationQueue читає process.env одразу під час імпорту.
	// Тому перед кожним тестом очищаємо кеш імпортів і задаємо тестові env-значення.
	vi.resetModules()
	Object.assign(process.env, queueEnv)
	return import('../src/features/material/infrastructure/cardGenerationQueue')
}

// У цій групі перевіряємо роботу черги генерації карток.
describe('card generation queue', () => {
	beforeEach(() => {
		// Перед кожним тестом очищаємо історію викликів моків.
		// Наприклад, queue.add знову буде вважатися "ще не викликаним".
		vi.clearAllMocks()

		// У коді черги є console.log і console.error.
		// У тестах ми їх вимикаємо, щоб очікувані помилки не засмічували консоль.
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		vi.spyOn(console, 'log').mockImplementation(() => undefined)
	})

	afterEach(() => {
		// Після кожного тесту повертаємо змінні оточення і console назад.
		// Це допомагає тримати тести незалежними один від одного.
		process.env = { ...savedEnv }
		vi.restoreAllMocks()
	})

	// Тест перевіряє ситуацію, коли черга вже заповнена.
	// Якщо ліміт дорівнює 2 і в черзі вже 2 задачі, нову задачу додавати не можна.
	it('rejects enqueue when queue limit is reached', async () => {
		const { enqueueCardGenerationJob } = await loadQueueModule()

		// Кажемо тесту: у черзі 1 задача waiting і 1 задача active.
		// Разом це 2, тобто рівно наш тестовий ліміт.
		mockCounts({ waiting: 1, active: 1 })

		// rejects перевіряє, що Promise завершився помилкою.
		// toMatchObject перевіряє, що в цій помилці є поле kind: 'rate_limited'.
		await expect(enqueueCardGenerationJob(jobData)).rejects.toMatchObject({ kind: 'rate_limited' })

		// Якщо ліміт перевищено, queue.add взагалі не має викликатися.
		expect(bullmq.queue.add).not.toHaveBeenCalled()
	})

	// Тест перевіряє, що технічна помилка Redis/BullMQ перетворюється
	// на зрозумілу помилку для застосунку.
	it('wraps BullMQ failures into external application errors', async () => {
		const { enqueueCardGenerationJob } = await loadQueueModule()
		mockCounts()

		// Тут імітуємо поломку: ніби BullMQ не зміг додати задачу в чергу.
		bullmq.queue.add.mockRejectedValue(new Error('Redis is down'))

		// Очікуємо не сирий текст "Redis is down", а нормальну помилку застосунку.
		await expect(enqueueCardGenerationJob(jobData)).rejects.toMatchObject({
			kind: 'external',
			message: 'Черга генерації тимчасово недоступна. Спробуйте пізніше.',
		})
	})

	// Тест перевіряє запуск worker-а.
	// Worker - це частина, яка бере задачу з черги і виконує генерацію карток.
	it('starts worker with configured limits and delegates job data', async () => {
		const { startCardGenerationWorker } = await loadQueueModule()

		// processor - це функція, яка має виконати задачу генерації.
		// Тут вона підроблена і просто повертає готовий результат.
		const processor = vi.fn().mockResolvedValue({
			pack: { id: 'pack-1', title: 'Матеріал', cardCount: 3 },
		})

		startCardGenerationWorker(processor)

		// Перевіряємо, що Worker створили з правильними налаштуваннями:
		// concurrency: 2 - можна виконувати 2 задачі паралельно;
		// limiter max/duration - не більше 5 задач за 2000 мс.
		expect(bullmq.Worker).toHaveBeenCalledWith(
			'card-generation',
			expect.any(Function),
			expect.objectContaining({
				concurrency: 2,
				limiter: { max: 5, duration: 2000 },
			}),
		)

		// Створюємо приклад задачі так, як її міг би передати BullMQ.
		const job = { data: jobData }

		// Викликаємо збережений processor вручну.
		// Так перевіряємо логіку без запуску реального worker-а.
		await bullmq.getProcessor()(job)

		// Перевіряємо, що наша функція processor отримала правильні аргументи:
		// спочатку дані задачі, потім сам об'єкт job.
		expect(processor).toHaveBeenCalledWith(job.data, job)
	})
})
