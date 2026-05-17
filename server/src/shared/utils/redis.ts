/**
 * Utility-файл: redis.
 *
 * Це єдина точка роботи з Redis у застосунку. Решта модулів користуються
 * невеликими helper-функціями cacheGet/cacheSet/cacheDel/cacheDelPattern і не
 * залежать від деталей ioredis. Якщо Redis недоступний, helpers повертаються
 * без помилки, а сервер продовжує працювати через базу даних.
 */

import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

/**
 * redis — спільний клієнт ioredis для всього процесу Node.js.
 *
 * У development середовищі модулі можуть перевантажуватись ts-node-dev/Vite
 * style tooling. Збереження клієнта в globalThis не дає створювати нове TCP
 * з'єднання після кожного reload. У production використовується звичайний
 * singleton на рівні модуля.
 *
 * lazyConnect: true означає, що Redis не блокує імпорт файлу. З'єднання
 * відкривається явно через connectRedis під час старту сервера або під час
 * першої операції, якщо клієнт уже готовий.
 */
const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    // family: 0 дозволяє Node/ioredis самостійно обрати IPv4 або IPv6. Це
    // зменшує проблеми між локальним Docker Redis і hosted Redis-провайдерами.
    family: 0,
    lazyConnect: true,
    retryStrategy: (times: number) => {
      // Після кількох невдалих спроб припиняємо reconnect. Кеш не критичний
      // для роботи застосунку, тому краще швидко перейти в режим "тільки БД",
      // ніж тримати запити користувача в очікуванні Redis.
      if (times > 3) return null;
      return Math.min(times * 500, 2000);
    },
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

// Помилка Redis не повинна валити процес: кеш є оптимізацією, а джерелом
// істини лишається PostgreSQL/Prisma. Тому тут тільки логування.
redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error (falling back to DB):', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

/**
 * connectRedis — явно відкриває lazy Redis-зʼєднання під час старту сервера.
 *
 * @returns true, якщо Redis готовий; false, якщо кеш треба вважати вимкненим.
 *          Помилка не прокидається вище, щоб запуск API не залежав від кешу.
 */
export async function connectRedis(): Promise<boolean> {
  if (redis.status === 'ready') return true;

  try {
    await redis.connect();
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Redis] Startup connection failed (cache disabled):', message);
    return false;
  }
}

/**
 * isRedisAvailable — перевіряє чи Redis зараз доступний.
 *
 * Helper-и кешу використовують цю перевірку перед кожною операцією. Це дає
 * просту деградацію: якщо Redis не ready, cacheGet повертає miss, а cacheSet
 * і cacheDel нічого не роблять.
 */
function isRedisAvailable(): boolean {
  return redis.status === 'ready';
}

/**
 * cacheGet — читає і десеріалізує JSON з Redis.
 *
 * Redis зберігає тільки рядки, тому всі складні DTO кладуться як JSON. Якщо
 * ключ відсутній, Redis недоступний або JSON пошкоджений, функція повертає
 * null. Для сервісів це означає звичайний cache miss і перерахунок з БД.
 *
 * @param key Повний ключ кешу, наприклад stats:user:<id>:summary.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!isRedisAvailable()) return null;

  try {
    const val = await redis.get(key);
    if (!val) return null;
    return JSON.parse(val) as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] cacheGet error for key "${key}":`, message);
    return null;
  }
}

/**
 * cacheSet — серіалізує об'єкт і зберігає в Redis з TTL.
 *
 * TTL обов'язковий, щоб агреговані відповіді не жили вічно і не показували
 * застарілу статистику після рідкісних сценаріїв, де інвалідація кешу могла
 * не спрацювати. Помилки логуються, але не зупиняють основний HTTP-запит.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!isRedisAvailable()) return;

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] cacheSet error for key "${key}":`, message);
  }
}

/**
 * cacheDel — видаляє один або кілька конкретних ключів.
 *
 * Використовується, коли сервіс точно знає ключ, який став неактуальним.
 * Наприклад, після відповіді на картку видаляється кеш деталей конкретного
 * паку для конкретного користувача.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (!isRedisAvailable()) return;

  try {
    await redis.del(...keys);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] cacheDel error:`, message);
  }
}

/**
 * cacheDelPattern — видаляє ключі що відповідають glob паттерну через SCAN.
 *
 * SCAN обрано замість KEYS, бо KEYS може заблокувати Redis на великій базі.
 * Функція збирає ключі невеликими порціями і видаляє їх одним del у кінці.
 * Це зручно для групової інвалідації, наприклад stats:user:<id>:* після
 * зміни прогресу навчання.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  if (!isRedisAvailable()) return;

  try {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== '0');

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] cacheDelPattern error for pattern "${pattern}":`, message);
  }
}
