import { defineConfig } from 'vitest/config';

// Це файл налаштувань Vitest.
// Тут ми пояснюємо, як саме треба запускати тести в цьому backend-проєкті.
export default defineConfig({
  test: {
    // Тести запускаються в Node.js, бо ми перевіряємо серверний код:
    // Express, fs, http, роботу з файлами та інші backend-речі.
    environment: 'node',

    // Vitest буде шукати тести в папці test
    // і запускати файли, назва яких закінчується на .test.ts.
    include: ['test/**/*.test.ts'],

    // Після кожного тесту Vitest очищає історію викликів mock-функцій.
    // Наприклад, якщо vi.fn() викликали в одному тесті,
    // наступний тест почнеться з чистої історії.
    clearMocks: true,
  },
});
