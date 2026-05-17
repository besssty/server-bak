/** Runtime environment configuration. */

const REQUIRED_ENV = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL'] as const;

export function validateRequiredEnv(): void {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      console.error(`[Startup] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  clientUrl: process.env.CLIENT_URL,
};
