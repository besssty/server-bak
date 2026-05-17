CREATE TYPE "MaterialGenerationStatus" AS ENUM ('idle', 'queued', 'failed', 'completed');

ALTER TABLE "Material"
ADD COLUMN "generationStatus" "MaterialGenerationStatus" NOT NULL DEFAULT 'idle',
ADD COLUMN "generationError" TEXT;

UPDATE "Material"
SET "generationStatus" = CASE
  WHEN "generatedPackId" IS NOT NULL THEN 'completed'::"MaterialGenerationStatus"
  WHEN "cardsGenerated" = true THEN 'queued'::"MaterialGenerationStatus"
  ELSE 'idle'::"MaterialGenerationStatus"
END;

CREATE UNIQUE INDEX "Material_generatedPackId_key" ON "Material"("generatedPackId");

ALTER TABLE "Material"
ADD CONSTRAINT "Material_generatedPackId_fkey"
FOREIGN KEY ("generatedPackId") REFERENCES "Pack"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
