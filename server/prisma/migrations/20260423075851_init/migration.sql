-- Створення таблиці користувачів Google OAuth.
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "googleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Створення приватних/публічних тем, до яких прив'язуються паки.
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- Створення паків карток у межах тем.
CREATE TABLE "Pack" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "topicId" TEXT NOT NULL,
    "createdById" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Pack_pkey" PRIMARY KEY ("id")
);

-- Створення навчальних карток з питанням і відповіддю.
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "packId" TEXT NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- Створення персонального SM-2 стану користувача для кожної картки.
CREATE TABLE "UserCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "interval" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "nextReviewDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLearned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserCard_pkey" PRIMARY KEY ("id")
);

-- Журнал відповідей користувача для статистики та аудиту навчання.
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "quality" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- Денна агрегація повторень для дашборду і streak-метрик.
CREATE TABLE "DailyStat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("id")
);

-- Унікальний email: один акаунт на пошту Google.
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Унікальний username для відображення в UI.
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Один Google profile прив'язується до одного User.
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- Slug теми унікальний у межах автора; різні юзери можуть мати однакові назви.
CREATE UNIQUE INDEX "Topic_slug_createdById_key" ON "Topic"("slug", "createdById");

-- Швидкий пошук карток, які дозріли для повторення конкретним користувачем.
CREATE INDEX "UserCard_userId_nextReviewDate_idx" ON "UserCard"("userId", "nextReviewDate");

-- Один UserCard на пару користувач-картка.
CREATE UNIQUE INDEX "UserCard_userId_cardId_key" ON "UserCard"("userId", "cardId");

-- Один DailyStat на користувача і календарний день.
CREATE UNIQUE INDEX "DailyStat_userId_date_key" ON "DailyStat"("userId", "date");

-- Тема видаляється разом із власником.
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Пак каскадно видаляється при видаленні теми.
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Якщо власника паку видалено, сам Pack може лишитись із createdById = null.
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Картки каскадно видаляються разом із паком.
ALTER TABLE "Card" ADD CONSTRAINT "Card_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Персональний стан карток видаляється разом із користувачем.
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Персональний стан видаляється, якщо базова картка видалена.
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Історія відповідей видаляється разом із користувачем.
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Історія відповідей видаляється разом із карткою.
ALTER TABLE "Review" ADD CONSTRAINT "Review_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Денна статистика належить користувачу і видаляється з ним.
ALTER TABLE "DailyStat" ADD CONSTRAINT "DailyStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
