/** Domain-файл: materialDomain. */

export const MATERIAL_CONSTRAINTS = {
  TITLE_MAX:       150,
  DESCRIPTION_MAX: 500,
  CONTENT_MIN:     2,    // мінімум слів, щоб матеріал не був порожнім
  CONTENT_MAX:     125_000,
  GENERATION_TOKEN_MAX: 10_000,
  PDF_MAX_SIZE_BYTES: 3 * 1024 * 1024,
} as const;

const ALLOWED_MATERIAL_TAGS = new Set([
  'p',
  'br',
  'h2',
  'h3',
  'strong',
  'b',
  'em',
  'i',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);

/**
 * sanitizeMaterialHtml — залишає тільки просту навчальну розмітку.
 *
 * Це серверний дубль клієнтського sanitizer-а: навіть якщо користувач обійде UI
 * і відправить HTML напряму, script/style/атрибути не потраплять у БД.
 */
export function sanitizeMaterialHtml(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, tagName: string) => {
      const normalized = tagName.toLowerCase();
      if (!ALLOWED_MATERIAL_TAGS.has(normalized)) return '';
      // Атрибути не зберігаються: це прибирає onclick/style/class і залишає
      // тільки семантичний тег.
      if (tag.startsWith('</')) return `</${normalized}>`;
      return normalized === 'br' ? '<br>' : `<${normalized}>`;
    });
}

/**
 * stripMaterialFormatting — відділяє шар форматування від тексту для GPT.
 * Матеріали можуть зберігати легкий Markdown, але генерація карток працює
 * з чистим текстом без службових символів розмітки.
 */
export function stripMaterialFormatting(content: string): string {
  const withoutHtml = content
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'");

  return withoutHtml
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[~#]/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function countWordsInText(content: string): number {
  return stripMaterialFormatting(content).split(/\s+/).filter(Boolean).length;
}

const TEXT_TOKEN_PART_PATTERN = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const WORD_OR_NUMBER_PATTERN = /^[\p{L}\p{N}]+$/u;

function countCodePoints(value: string): number {
  return [...value].length;
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }

  return true;
}

function estimateTokenPartCount(part: string): number {
  const charCount = countCodePoints(part);

  if (!WORD_OR_NUMBER_PATTERN.test(part)) {
    return charCount;
  }

  const charsPerToken = isAscii(part) ? 4 : 3;
  return Math.max(1, Math.ceil(charCount / charsPerToken));
}

/**
 * isContentSufficientForGeneration — перевіряє чи є достатньо тексту
 * для генерації флешкарток.
 */
export function isContentSufficientForGeneration(content: string): boolean {
  return countMaterialWords(content) >= MATERIAL_CONSTRAINTS.CONTENT_MIN;
}

/**
 * estimateMaterialTokenCount — локальна оцінка кількості text tokens.
 * Вона потрібна, щоб відсікати надто великі матеріали до постановки в чергу
 * генерації і не відправляти їх у GPT-запит.
 */
export function estimateMaterialTokenCount(content: string): number {
  const plainContent = stripMaterialFormatting(content);
  if (!plainContent) return 0;

  const parts = plainContent.match(TEXT_TOKEN_PART_PATTERN) ?? [];
  return parts.reduce((total, part) => total + estimateTokenPartCount(part), 0);
}

/**
 * countMaterialWords — єдине місце для підрахунку слів у матеріалі.
 */
function countMaterialWords(content: string): number {
  return countWordsInText(content);
}
