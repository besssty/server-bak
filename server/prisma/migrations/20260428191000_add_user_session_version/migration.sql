-- Версія сесії для серверної інвалідації refresh token під час logout.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
