-- Додаємо особисті навчальні матеріали/конспекти користувача.
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "cardsGenerated" BOOLEAN NOT NULL DEFAULT false,
    "generatedPackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- Матеріал завжди належить конкретному користувачу і видаляється разом із ним.
ALTER TABLE "Material" ADD CONSTRAINT "Material_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
