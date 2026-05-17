import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// Тут ми беремо з Vitest три головні речі для тестів:
// describe - назва групи тестів;
// it - один конкретний тест;
// expect - перевірка, що результат саме такий, як ми очікуємо.
import { describe, expect, it } from 'vitest'
import {
	calculateSM2,
	SM_INITIAL_STATE,
	type SM2Input,
} from '../src/features/session/domain/sm2Service'

// Це опис одного рядка з CSV-таблиці.
// Завдяки цьому TypeScript знає, які поля має мати кожен тестовий приклад.
type SM2TableCase = {
	n: number
	day: number
	quality: number
	expectedEaseBefore: number
	expectedEaseAfter: number
	expectedInterval: number
}

function parseDecimal(value: string) {
	// У таблиці число може бути записане як 2,50, але JavaScript розуміє 2.50.
	// Тому міняємо кому на крапку і перетворюємо текст на число.
	return Number(value.replace(',', '.'))
}

function loadTableCases(): SM2TableCase[] {
	// Тут будуємо шлях до CSV-файлу з тестовими даними.
	// У цьому файлі лежить таблиця з очікуваними результатами алгоритму SM-2.
	const csvPath = join(process.cwd(), 'test', 'fixtures', 'sm2AlgorithmTable.csv')

	// Читаємо файл як текст, прибираємо зайві пробіли в кінці
	// і ділимо його на окремі рядки.
	const lines: string[] = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/)

	// Перший рядок CSV - це назви колонок, усі інші рядки - самі дані.
	const [headerLine = '', ...rows] = lines
	const headers: string[] = headerLine.split(';')

	// Перетворюємо кожен рядок CSV у звичайний об'єкт JavaScript.
	// Так далі в тесті зручно працювати не з текстом, а з готовими числами.
	return rows.map((row: string): SM2TableCase => {
		const values = row.split(';')

		// Робимо об'єкт виду:
		// { n: '1', day: '1', quality: '3', ... }
		// Тобто назва колонки стає ключем, а значення з рядка - значенням.
		const record = Object.fromEntries(
			headers.map((header: string, index: number) => [header, values[index] ?? '']),
		) as Record<string, string>

		return {
			n: Number(record.n),
			day: Number(record.day),
			quality: Number(record.quality),
			expectedEaseBefore: parseDecimal(record.expectedEaseBefore),
			expectedEaseAfter: parseDecimal(record.expectedEaseAfter),
			expectedInterval: Number(record.expectedInterval),
		}
	})
}

// describe об'єднує тести в одну групу.
// Тут група називається "SM-2 algorithm table", бо ми перевіряємо таблицю SM-2.
describe('SM-2 algorithm table', () => {
	// it - це один тест. Його назва пояснює, що саме має бути перевірено.
	// У цьому тесті ми читаємо таблицю з файлу, запускаємо алгоритм
	// і перевіряємо, що результат збігається з очікуваними числами.
	it('prints and verifies the expected SM-2 calculation table from file data', () => {
		// Початковий стан картки беремо з SM_INITIAL_STATE.
		// Далі після кожного кроку ми будемо оновлювати state,
		// ніби користувач реально повторює одну й ту саму картку кілька разів.
		let state: SM2Input = {
			repetition: SM_INITIAL_STATE.repetition,
			interval: SM_INITIAL_STATE.interval,
			easeFactor: SM_INITIAL_STATE.easeFactor,
		}

		const consoleRows = loadTableCases().map(testCase => {
			// calculateSM2 - це справжня функція з застосунку.
			// Ми передаємо їй поточний стан картки і оцінку відповіді користувача.
			const result = calculateSM2(state, testCase.quality)

			// Цей об'єкт потрібен тільки для красивого виводу таблиці в консоль.
			// На проходження тесту він сам по собі не впливає.
			const row = {
				n: testCase.n,
				День: testCase.day,
				q: testCase.quality,
				'EF до': state.easeFactor.toFixed(2),
				'EF після': result.easeFactor.toFixed(2),
				'I (днів)': result.interval,
			}

			// expect означає "очікую, що значення буде таким".
			// toBeCloseTo потрібен для дробових чисел, наприклад 2.5 або 2.36.
			// Другий аргумент 2 означає: порівнюємо приблизно до 2 знаків після коми.
			expect(state.easeFactor).toBeCloseTo(testCase.expectedEaseBefore, 2)
			expect(result.easeFactor).toBeCloseTo(testCase.expectedEaseAfter, 2)

			// toBe перевіряє точну рівність.
			// Тут це підходить, бо interval - це ціле число днів.
			expect(result.interval).toBe(testCase.expectedInterval)

			// Результат цього рядка стає початковим станом для наступного рядка.
			// Так тест перевіряє послідовне навчання, а не один окремий виклик.
			state = {
				repetition: result.repetition,
				interval: result.interval,
				easeFactor: result.easeFactor,
			}

			return row
		})

		// console.table просто показує таблицю в консолі після запуску тесту.
		// Це зручно для дипломної роботи або демонстрації розрахунків.
		console.table(consoleRows)
	})
})
