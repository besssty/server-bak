import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// У Vitest ці три функції використовуються майже в кожному тесті:
// describe - створює групу тестів;
// it - створює один тест;
// expect - перевіряє, що результат правильний.
import { describe, expect, it } from 'vitest'
import { calculateAnswerRetentionRate } from '../src/features/stats/domain/statsDomain'

// Це тип одного рядка з таблиці Retention Rate.
// Він показує, які дані ми очікуємо отримати з CSV-файлу.
type RetentionTableRow = {
	day: string
	reviewCount: number
	correctCount: number
	calculation: string
	expectedRetention: number | null
}

function loadRetentionTableRows(): RetentionTableRow[] {
	// Тут знаходимо CSV-файл з готовою таблицею для тесту.
	// CSV - це звичайний текстовий файл, де дані записані рядками і колонками.
	const csvPath = join(process.cwd(), 'test', 'fixtures', 'retentionRateTable.csv')

	// Читаємо файл, прибираємо зайві пробіли в кінці та ділимо текст на рядки.
	const lines: string[] = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/)

	// Перший рядок - назви колонок, наприклад day, reviewCount, correctCount.
	// Інші рядки - це дані таблиці.
	const [headerLine = '', ...rows] = lines
	const headers = headerLine.split(';')

	// Кожен рядок таблиці перетворюємо на об'єкт.
	// Так далі можна писати row.reviewCount, а не шукати потрібну колонку вручну.
	return rows.map((row): RetentionTableRow => {
		const values = row.split(';')

		// Object.fromEntries збирає об'єкт з пар "назва колонки - значення".
		// Наприклад: { day: '1', reviewCount: '4', correctCount: '3' }.
		const record = Object.fromEntries(
			headers.map((header, index) => [header, values[index] ?? '']),
		) as Record<string, string>

		return {
			day: record.day,
			reviewCount: Number(record.reviewCount),
			correctCount: Number(record.correctCount),
			calculation: record.calculation,
			expectedRetention: record.expectedRetention ? Number(record.expectedRetention) : null,
		}
	})
}

function getDailyRows(rows: RetentionTableRow[]) {
	// У щоденних рядках ще немає готового підсумкового відсотка.
	// Тому expectedRetention там дорівнює null.
	return rows.filter(row => row.expectedRetention === null)
}

function getTotalRow(rows: RetentionTableRow[]) {
	// Підсумковий рядок - це той, де expectedRetention уже має число.
	const totalRow = rows.find(row => row.expectedRetention !== null)

	// Якщо такого рядка немає, тест одразу падає з понятною помилкою.
	// Це означає, що проблема не в коді розрахунку, а в тестовій таблиці.
	if (!totalRow) throw new Error('У таблиці Retention Rate немає підсумкового рядка')

	return totalRow
}

// describe об'єднує всі тести, які стосуються Retention Rate.
describe('Retention Rate table', () => {
	// У цьому тесті ми:
	// 1. читаємо таблицю з CSV;
	// 2. рахуємо загальну кількість відповідей;
	// 3. запускаємо функцію calculateAnswerRetentionRate;
	// 4. перевіряємо, що результат дорівнює очікуваному.
	it('prints and verifies the expected Retention Rate calculation table from file data', () => {
		const rows = loadRetentionTableRows()
		const dailyRows = getDailyRows(rows)
		const totalRow = getTotalRow(rows)

		// reduce проходить по всіх денних рядках і складає числа.
		// Тут ми окремо рахуємо всі відповіді та правильні відповіді.
		const totalReviews = dailyRows.reduce((sum, row) => sum + row.reviewCount, 0)
		const totalCorrect = dailyRows.reduce((sum, row) => sum + row.correctCount, 0)

		// Це головна функція, яку ми тестуємо.
		// Вона має повернути відсоток правильних відповідей.
		const retentionRate = calculateAnswerRetentionRate(dailyRows)

		// toBe перевіряє точну рівність.
		// Якщо хоча б одне значення буде іншим, Vitest покаже помилку.
		expect(totalReviews).toBe(totalRow.reviewCount)
		expect(totalCorrect).toBe(totalRow.correctCount)
		expect(retentionRate).toBe(totalRow.expectedRetention)

		// Тут додатково перевіряємо текст формули з таблиці.
		// Це потрібно, щоб приклад розрахунку у файлі теж був правильним.
		expect(totalRow.calculation).toBe('R = round((12/16)×100%) = 75%')

		// Готуємо дані для красивого виводу через console.table.
		// Це не перевірка, а просто зручна таблиця в консолі.
		const consoleRows = [
			...dailyRows.map(row => ({
				День: row.day,
				'Всього відповідей N': row.reviewCount,
				'Правильних C': row.correctCount,
				Розрахунок: row.calculation,
			})),
			{
				День: totalRow.day,
				'Всього відповідей N': totalRow.reviewCount,
				'Правильних C': totalRow.correctCount,
				Розрахунок: totalRow.calculation,
			},
		]

		// console.table показує результат у вигляді таблиці.
		// Сам тест проходить або падає тільки через expect-перевірки вище.
		console.table(consoleRows)
	})
})
