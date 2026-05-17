/** Infrastructure-файл: pdfParser. */

import fs from 'fs/promises'
import { PDFParse } from 'pdf-parse'

const PDF_IMAGE_PLACEHOLDER_RE = /\s*--\s*\d+\s+of\s+\d+\s*--\s*/gi
const PDF_BULLET_SYMBOLS = '\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25AA\uF0B7'
const BULLET_LIST_MARKER_RE = new RegExp(`^(?:[${PDF_BULLET_SYMBOLS}]\\s*|[-*+]\\s+)`)
const LIST_LINE_RE = new RegExp(
	`^(?:[${PDF_BULLET_SYMBOLS}]\\s*|[-*+]\\s+|\\d+[.)]\\s+|[A-Za-zА-Яа-яІіЇїЄєҐґ][.)]\\s+)`,
)
const ORDERED_LIST_LINE_RE = /^(\d+)[.)]\s+/
const PAGE_NUMBER_RE =
	/^(?:\d+|(?:page|p\.?|сторінка|стр\.?|страница)\s*\d+(?:\s*(?:of|з|із|\/)\s*\d+)?|\d+\s*(?:of|з|із|\/)\s*\d+)$/i
const SENTENCE_END_RE = /[.!?…]$/

type PdfPageContent = {
	text: string
}

async function extractPdfPages(filePath: string): Promise<PdfPageContent[]> {
	const buffer = await fs.readFile(filePath)
	const parser = new PDFParse({ data: buffer })

	try {
		const textResult = await parser.getText({
			lineEnforce: true,
			pageJoiner: '\f',
		})

		return textResult.pages.map(page => ({
			text: page.text,
		}))
	} finally {
		await parser.destroy()
	}
}

function normalizePdfLineForStructure(line: string): string {
	return line
		// pdf-parse іноді повертає службові маркери зображень на кшталт "-- 1 of 1 --".
		.replace(PDF_IMAGE_PLACEHOLDER_RE, ' ')
		.replace(/\u00a0/g, ' ')
		.replace(/\t[ \t]*/g, '\t')
		.replace(/[ \t]*\t/g, '\t')
		.trim()
}

// Нормалізує один рядок PDF: прибирає службові маркери, зайві пробіли та таби.
function normalizePdfLine(line: string): string {
	return normalizePdfLineForStructure(line)
		.replace(/\t/g, ' ')
		.replace(/[ ]{2,}/g, ' ')
		.trim()
}

// Готує весь сирий текст PDF до построкового аналізу.
function normalizePdfText(rawText: string): string {
	return rawText
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
}

// Перевіряє, чи рядок схожий на пункт маркованого або нумерованого списку.
function isListLine(line: string): boolean {
	return LIST_LINE_RE.test(line)
}

function stripBulletListMarker(line: string): string {
	return line.replace(BULLET_LIST_MARKER_RE, '').trim()
}

function renderMarkdownListItem(line: string): string {
	const orderedMatch = line.match(ORDERED_LIST_LINE_RE)
	if (orderedMatch) {
		return `${orderedMatch[1]}. ${line.slice(orderedMatch[0].length).trim()}`
	}

	return `- ${stripBulletListMarker(line)}`
}

// Визначає прості номери сторінок і службові підписи сторінок.
function isLikelyPageNumber(line: string): boolean {
	return PAGE_NUMBER_RE.test(line.trim())
}

// Перевіряє, чи рядок може бути повторюваним колонтитулом, який варто прибрати.
function isRepeatedLineCandidate(line: string): boolean {
	if (line.length < 3 || line.length > 120) return false
	if (isLikelyPageNumber(line)) return false
	if (isListLine(line)) return false

	return true
}

// Шукає рядки, які повторюються на більшості сторінок і схожі на колонтитули.
function findRepeatedPageLines(pages: string[]): Set<string> {
	const occurrences = new Map<string, number>()

	for (const page of pages) {
		const uniquePageLines = new Set(
			page
				.split('\n')
				.map(normalizePdfLine)
				.filter(isRepeatedLineCandidate),
		)

		for (const line of uniquePageLines) {
			occurrences.set(line, (occurrences.get(line) ?? 0) + 1)
		}
	}

	const minOccurrences = Math.max(3, Math.ceil(pages.length * 0.6))
	return new Set(
		[...occurrences.entries()]
			.filter(([, count]) => count >= minOccurrences)
			.map(([line]) => line),
	)
}

// Вирішує, чи треба пропустити рядок PDF як службовий шум.
function shouldSkipPdfLine(rawLine: string, repeatedLines: Set<string>, hasMultiplePages: boolean): boolean {
	const line = normalizePdfLine(rawLine)
	if (!line) return false
	if (hasMultiplePages && isLikelyPageNumber(line)) return true

	// Повторювані колонтитули зазвичай не несуть навчальної цінності,
	// але сильно засмічують матеріал і майбутні картки.
	return repeatedLines.has(line)
}

// Перетворює сирий PDF-текст на список корисних рядків без номерів сторінок і колонтитулів.
function getPdfLines(rawText: string): string[] {
	const normalizedText = normalizePdfText(rawText)
	const pages = normalizedText.split(/\f+/)
	const repeatedLines = pages.length >= 3 ? findRepeatedPageLines(pages) : new Set<string>()
	const hasMultiplePages = pages.length > 1

	return pages.flatMap((page, pageIndex) => {
		const lines = page
			.split('\n')
			.filter(line => !shouldSkipPdfLine(line, repeatedLines, hasMultiplePages))

		// Розрив сторінки залишаємо як порожній рядок, щоб не склеїти різні абзаци.
		return pageIndex < pages.length - 1 ? [...lines, ''] : lines
	})
}

function countWords(line: string): number {
	return line.split(/\s+/).filter(Boolean).length
}

function isAllCapsLike(line: string): boolean {
	const letters = line.match(/\p{L}/gu) ?? []
	if (letters.length < 4) return false

	const upperLetters = letters.filter(letter => letter === letter.toUpperCase())
	return upperLetters.length / letters.length >= 0.75
}

function isLikelyHeading(line: string, previousLine: string | undefined, nextLine: string | undefined): boolean {
	if (line.includes('\t')) return false

	const normalized = normalizePdfLine(line)
	if (!normalized) return false
	if (isListLine(normalized) || isLikelyPageNumber(normalized)) return false
	if (normalized.length < 3 || normalized.length > 90) return false
	if (countWords(normalized) > 12) return false
	if (SENTENCE_END_RE.test(normalized)) return false

	const previousIsBlank = !previousLine?.trim()
	const nextIsBlank = !nextLine?.trim()
	const looksNumberedHeading = /^\d+(?:\.\d+)*\.?\s+\S+/.test(normalized)

	return previousIsBlank || nextIsBlank || isAllCapsLike(normalized) || looksNumberedHeading
}

function getHeadingLevel(line: string): 2 | 3 {
	if (/^\d+\.\d+/.test(line)) return 3
	return 2
}

function pushBlock(blocks: string[], block: string): void {
	const normalized = block.trim()
	if (normalized) blocks.push(normalized)
}

function formatPdfPageTextAsMarkdown(rawText: string, repeatedLines: Set<string>, hasMultiplePages: boolean): string {
	const rawLines = normalizePdfText(rawText).split('\n')
	const blocks: string[] = []
	let paragraph: string[] = []
	let listItems: string[] = []

	const flushParagraph = () => {
		pushBlock(blocks, paragraph.join(' '))
		paragraph = []
	}

	const flushList = () => {
		pushBlock(blocks, listItems.join('\n'))
		listItems = []
	}

	for (let index = 0; index < rawLines.length; index += 1) {
		const rawLine = rawLines[index]
		const line = normalizePdfLine(rawLine)

		if (!line) {
			flushParagraph()
			flushList()
			continue
		}

		if (shouldSkipPdfLine(rawLine, repeatedLines, hasMultiplePages)) continue

		if (isListLine(line)) {
			flushParagraph()
			listItems.push(renderMarkdownListItem(line))
			continue
		}

		flushList()

		if (paragraph.length === 0 && isLikelyHeading(line, rawLines[index - 1], rawLines[index + 1])) {
			pushBlock(blocks, `${'#'.repeat(getHeadingLevel(line))} ${line}`)
			continue
		}

		paragraph.push(line)
	}

	flushParagraph()
	flushList()

	return blocks.join('\n\n')
}

/**
 * formatPdfTextAsMarkdown — перетворює текст PDF на легкий Markdown:
 * заголовки, списки та абзаци, які потім відкриває Tiptap.
 */
export function formatPdfTextAsMarkdown(rawText: string): string {
	const lines = getPdfLines(rawText)
	return formatPdfPageTextAsMarkdown(lines.join('\n'), new Set<string>(), false)
}

function getRepeatedLinesFromPages(pages: PdfPageContent[]): Set<string> {
	if (pages.length < 3) return new Set<string>()
	return findRepeatedPageLines(pages.map(page => page.text))
}

function formatPdfPagesAsMarkdown(pages: PdfPageContent[]): string {
	const repeatedLines = getRepeatedLinesFromPages(pages)
	const hasMultiplePages = pages.length > 1

	return pages
		.map(page => formatPdfPageTextAsMarkdown(page.text, repeatedLines, hasMultiplePages))
		.filter(Boolean)
		.join('\n\n')
}

/**
 * extractStructuredTextFromPdf — витягує текст і повертає очищений Markdown,
 * який безпечно зберігати як content матеріалу.
 */
export async function extractStructuredTextFromPdf(filePath: string): Promise<string> {
	const pages = await extractPdfPages(filePath)
	return formatPdfPagesAsMarkdown(pages)
}
