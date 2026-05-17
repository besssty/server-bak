/** Domain-файл: authDomain. */

/**
 * sanitizeUsername — очищає рядок для використання як username.
 *
 * Правила:
 *  - Тільки a-z, 0-9, underscore (lowercase)
 *  - Максимум 16 символів
 *  - Якщо рядок порожній після очищення — повертаємо 'user'
 */
export function sanitizeUsername(base: string): string {
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 16) || 'user';
}
