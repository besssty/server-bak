-- Пак більше не може бути публічним або без власника.
-- Якщо старий pack не мав owner, але його тема належала користувачу, переносимо owner з теми.
UPDATE "Pack"
SET "createdById" = "Topic"."createdById"
FROM "Topic"
WHERE "Pack"."topicId" = "Topic"."id"
  AND "Pack"."createdById" IS NULL
  AND "Topic"."createdById" IS NOT NULL;

-- Публічні/осиротілі паки без власника більше не підтримуються.
-- Видалення Pack каскадно прибере його Card/UserCard/Review записи через існуючі FK.
DELETE FROM "Pack"
WHERE "createdById" IS NULL;

ALTER TABLE "Pack" DROP CONSTRAINT "Pack_createdById_fkey";
ALTER TABLE "Pack" ALTER COLUMN "createdById" SET NOT NULL;
ALTER TABLE "Pack" DROP COLUMN "isPrivate";
ALTER TABLE "Pack" ADD CONSTRAINT "Pack_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
