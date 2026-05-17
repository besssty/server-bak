import express from 'express'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
// Тут беремо інструменти Vitest:
// beforeAll - виконати підготовку один раз перед усіма тестами;
// afterAll - прибрати все після тестів;
// describe - група тестів;
// it - один тест;
// expect - перевірка результату.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MATERIAL_CONSTRAINTS } from '../src/features/material/domain/materialDomain'
import { ensureMaterialUploadTmpDir, materialPdfUpload } from '../src/features/material/infrastructure/upload'

// У цьому файлі тестуємо завантаження PDF.
// Для цього створюємо маленький тестовий Express-сервер.
let server!: http.Server
let baseUrl = ''
const tmpDir = path.join(process.cwd(), 'tmp')

// Під час завантаження файлів multer створює тимчасові файли.
// Ця функція видаляє папку tmp, щоб після тестів не лишався сміттєвий файл.
const cleanupTmpUploads = () => fs.rmSync(tmpDir, { force: true, recursive: true })

async function postFile(fileName: string, mimeType: string, content: string | ArrayBuffer) {
	// FormData - це спосіб відправити файл так, як це робить браузер у формі.
	const form = new FormData()

	// Blob - це вміст файлу. Тут ми створюємо файл прямо в тесті.
	// Назва поля 'pdf' важлива, бо сервер очікує саме поле з такою назвою.
	form.append('pdf', new Blob([content], { type: mimeType }), fileName)

	// Відправляємо POST-запит на тестовий сервер.
	// У відповідь повертаємо статус і JSON, щоб їх було легко перевіряти.
	const response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form })
	return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

const uploadErrorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
	// Якщо multer відхиляє файл, Express отримує помилку.
	// Тут ми перетворюємо цю помилку на JSON, щоб тест міг легко перевірити текст і код.
	const error = err as Error & { code?: string }
	res.status(400).json({ error: error.message, code: error.code })
}

// У цій групі всі тести про завантаження PDF-файлів.
describe('material PDF upload', () => {
	// beforeAll запускається один раз перед усіма тестами в цьому describe.
	// Тут ми створюємо папку tmp і запускаємо тестовий сервер.
	beforeAll(async () => {
		cleanupTmpUploads()
		ensureMaterialUploadTmpDir()

		const app = express()
		app.post('/upload', materialPdfUpload.single('pdf'), (req, res) => {
			// materialPdfUpload.single('pdf') приймає один файл з поля pdf.
			// Якщо файл підходить, інформація про нього з'являється в req.file.
			// У відповіді повертаємо тільки ті поля, які хочемо перевірити.
			res.json({ originalname: req.file?.originalname, mimetype: req.file?.mimetype })
		})
		app.use(uploadErrorHandler)

		// app.listen(0) означає: "запусти сервер на будь-якому вільному порту".
		// Так тест не конфліктує з іншими програмами на комп'ютері.
		await new Promise<void>(resolve => {
			server = app.listen(0, () => resolve())
		})

		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('Test server did not start')

		// Запам'ятовуємо адресу сервера, щоб helper postFile знав, куди відправляти файл.
		baseUrl = `http://127.0.0.1:${address.port}`
	})

	// afterAll запускається один раз після всіх тестів.
	// Тут ми закриваємо сервер і чистимо тимчасову папку.
	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close(err => (err ? reject(err) : resolve())),
		)
		cleanupTmpUploads()
	})

	// Перший тест перевіряє хороший сценарій:
	// користувач завантажує PDF правильного типу і нормального розміру.
	it('accepts a PDF file within the configured size limit', async () => {
		const response = await postFile('lecture.pdf', 'application/pdf', '%PDF-1.4\nМатеріал\n%%EOF')

		// Очікуємо HTTP-статус 200. Це означає, що запит успішний.
		expect(response.status).toBe(200)

		// toMatchObject перевіряє тільки вказані поля.
		// Нам не важливий увесь об'єкт, важливі лише originalname і mimetype.
		expect(response.body).toMatchObject({
			originalname: 'lecture.pdf',
			mimetype: 'application/pdf',
		})
	})

	// Другий тест перевіряє погані сценарії:
	// 1. файл не PDF;
	// 2. PDF завеликий.
	it('rejects unsupported format and oversized PDF', async () => {
		// Спочатку перевіряємо сам ліміт: максимум має бути 3 MiB.
		// Якщо хтось змінить це значення в домені, тест одразу покаже різницю.
		expect(MATERIAL_CONSTRAINTS.PDF_MAX_SIZE_BYTES).toBe(3 * 1024 * 1024)

		for (const [name, mime, content, expected] of [
			['lecture.txt', 'text/plain', 'Це не PDF файл', { error: 'Дозволені тільки PDF файли' }],
			['too-large.pdf', 'application/pdf', new ArrayBuffer(MATERIAL_CONSTRAINTS.PDF_MAX_SIZE_BYTES + 1), { code: 'LIMIT_FILE_SIZE', error: 'File too large' }],
		] as const) {
			// Беремо один набір даних, відправляємо файл і дивимось, яку помилку повернув сервер.
			const response = await postFile(name, mime, content)

			// Для помилки очікуємо HTTP-статус 400.
			expect(response.status).toBe(400)

			// Перевіряємо, що текст або код помилки збігається з очікуваним.
			expect(response.body).toMatchObject(expected)
		}
	})
})
