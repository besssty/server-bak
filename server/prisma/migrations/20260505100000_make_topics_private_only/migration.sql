-- Тема більше не може бути публічною або без власника.
-- Старі публічні/осиротілі теми неможливо прив'язати до конкретного користувача.
-- Видалення Topic каскадно прибере пов'язані Pack/Card/UserCard/Review записи через існуючі FK.
DELETE FROM "Topic"
WHERE "createdById" IS NULL;

ALTER TABLE "Topic" DROP CONSTRAINT "Topic_createdById_fkey";
ALTER TABLE "Topic" ALTER COLUMN "createdById" SET NOT NULL;
ALTER TABLE "Topic" DROP COLUMN "isPrivate";
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Topic_createdById_idx" ON "Topic"("createdById");
