# ─── Етап 1: збірка TypeScript ────────────────────────────────
FROM node:22-slim AS builder

# openssl потрібен Prisma engine для підключення до PostgreSQL у Debian slim образі.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Спершу копіюємо package*.json і prisma, щоб Docker кешував npm ci до зміни src.
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

# Build запускає prisma generate перед tsc, бо src імпортує generated client. Railway підставить реальний URL на runtime.
RUN DATABASE_URL="postgresql://user:password@localhost:5432/flashlearn" npm run build

# ─── Етап 2: production-середовище виконання ─────────────────
FROM node:22-slim AS runner

# Середовище виконання теж потребує openssl для Prisma engine.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# У production ставимо тільки залежності виконання без dev-пакетів TypeScript.
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci --omit=dev

# Беремо тільки зібраний dist з builder-етапу, source TS у середовищі виконання не потрібен.
COPY --from=builder /app/dist ./dist/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# На старті застосовуємо міграції, потім запускаємо скомпільований Express сервер.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
