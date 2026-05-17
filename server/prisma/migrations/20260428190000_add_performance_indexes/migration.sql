-- Індекси для типових приватних запитів: паки користувача, паки теми,
-- картки паку, історія повторень і список матеріалів за датою оновлення.
CREATE INDEX "Pack_createdById_idx" ON "Pack"("createdById");
CREATE INDEX "Pack_topicId_createdById_idx" ON "Pack"("topicId", "createdById");
CREATE INDEX "Card_packId_idx" ON "Card"("packId");
CREATE INDEX "Review_userId_reviewedAt_idx" ON "Review"("userId", "reviewedAt");
CREATE INDEX "Material_ownerId_updatedAt_idx" ON "Material"("ownerId", "updatedAt");
