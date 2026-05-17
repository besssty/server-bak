-- Паки больше не группируются через Topic: они напрямую принадлежат пользователю.
ALTER TABLE "Pack" DROP CONSTRAINT IF EXISTS "Pack_topicId_fkey";

DROP INDEX IF EXISTS "Pack_topicId_createdById_idx";
DROP INDEX IF EXISTS "Topic_slug_createdById_key";
DROP INDEX IF EXISTS "Topic_createdById_idx";

ALTER TABLE "Pack" DROP COLUMN IF EXISTS "topicId";

DROP TABLE IF EXISTS "Topic";
