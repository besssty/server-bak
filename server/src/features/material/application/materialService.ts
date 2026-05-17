/** Application-сервіс: materialService. */

import { ApplicationError } from '../../../shared/application/errors';
import { cacheDelPattern } from '../../../shared/utils/redis';
import { SM_INITIAL_STATE } from '../../session/domain/sm2Service';
import {
  estimateMaterialTokenCount,
  isContentSufficientForGeneration,
  MATERIAL_CONSTRAINTS,
  sanitizeMaterialHtml,
  stripMaterialFormatting,
} from '../domain/materialDomain';
import { materialRepository } from '../infrastructure/materialRepository';
import { openAiCardGenerator } from '../infrastructure/openAiCardGenerator';
import { pdfTextExtractor } from '../infrastructure/pdfTextExtractor';
import {
  enqueueCardGenerationJob,
  type CardGenerationJobData,
  type CardGenerationJobResult,
} from '../infrastructure/cardGenerationQueue';
import type { CardGeneratorPort, PdfTextExtractorPort } from './ports';

interface MaterialInput {
  title: string;
  description?: string;
}

interface UpdateMaterialInput {
  title?: string;
  description?: string | null;
  content?: string;
}

interface MaterialServiceDeps {
  cardGenerator: CardGeneratorPort;
  pdfExtractor: PdfTextExtractorPort;
}

interface GenerationContext {
  material: {
    id: string;
    title: string;
    description: string | null;
  };
  plainContent: string;
}

const defaultDeps: MaterialServiceDeps = {
  cardGenerator: openAiCardGenerator,
  pdfExtractor: pdfTextExtractor,
};

async function loadGenerationContext(
  userId: string,
  materialId: string,
  allowGenerationLock: boolean
): Promise<GenerationContext> {
  const material = await materialRepository.findMaterialOwned(materialId, userId);

  if (!material) {
    throw new ApplicationError('Матеріал не знайдено або доступ заборонено', 'not_found');
  }

  if (material.generatedPackId || material.generationStatus === 'completed') {
    throw new ApplicationError('Картки для цього матеріалу вже були згенеровані', 'conflict');
  }

  if (material.generationStatus === 'queued' && !allowGenerationLock) {
    throw new ApplicationError(
      'Картки для цього матеріалу вже генеруються або були згенеровані',
      'conflict'
    );
  }

  if (allowGenerationLock && material.generationStatus !== 'queued') {
    throw new ApplicationError('Задача генерації вже неактивна', 'conflict');
  }

  const plainContent = stripMaterialFormatting(material.content);

  if (!isContentSufficientForGeneration(plainContent)) {
    throw new ApplicationError(
      `Матеріал містить замало тексту. Мінімум ${MATERIAL_CONSTRAINTS.CONTENT_MIN} слова.`,
      'validation'
    );
  }

  const tokenCount = estimateMaterialTokenCount(plainContent);
  if (tokenCount > MATERIAL_CONSTRAINTS.GENERATION_TOKEN_MAX) {
    throw new ApplicationError(
      `Матеріал занадто довгий для генерації. Максимум ${MATERIAL_CONSTRAINTS.GENERATION_TOKEN_MAX} токенів, зараз приблизно ${tokenCount}.`,
      'validation'
    );
  }

  return { material, plainContent };
}

interface MaterialForLearningStats {
  generatedPack: {
    cards: {
      id: string;
      userCards: {
        isLearned: boolean;
        nextReviewDate: Date;
      }[];
    }[];
  } | null;
}

function emptyMaterialLearningStats() {
  return {
    cardCount: 0,
    learnedCount: 0,
    dueCount: 0,
    nextReviewDate: null,
    progressPercent: 0,
  };
}

function getTodayEnd(): Date {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return today;
}

function getMaterialLearningStats(material: MaterialForLearningStats) {
  const cards = material.generatedPack?.cards ?? [];
  if (cards.length === 0) return emptyMaterialLearningStats();

  const todayEnd = getTodayEnd();
  const futureReviewDates: Date[] = [];
  let learnedCount = 0;
  let dueCount = 0;
  let trackedCards = 0;

  for (const card of cards) {
    const userCard = card.userCards[0];
    if (!userCard) continue;

    trackedCards += 1;
    if (userCard.isLearned) learnedCount += 1;

    if (userCard.nextReviewDate <= todayEnd) {
      dueCount += 1;
    } else {
      futureReviewDates.push(userCard.nextReviewDate);
    }
  }

  const cardCount = cards.length;
  const effectiveDueCount = cardCount > 0 && trackedCards === 0 ? cardCount : dueCount;
  const nextReviewDate = futureReviewDates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return {
    cardCount,
    learnedCount,
    dueCount: effectiveDueCount,
    nextReviewDate,
    progressPercent: cardCount > 0 ? Math.round((learnedCount / cardCount) * 100) : 0,
  };
}

function serializeMaterial<T extends MaterialForLearningStats>(material: T) {
  const { generatedPack, ...base } = material;
  return {
    ...base,
    ...getMaterialLearningStats(material),
  };
}

function serializeMaterialWithoutGeneratedPack<T extends object>(material: T) {
  return {
    ...material,
    ...emptyMaterialLearningStats(),
  };
}

export async function listMaterials(userId: string) {
  const materials = await materialRepository.findMaterials(userId);
  return materials.map(serializeMaterial);
}

export async function createMaterial(userId: string, input: MaterialInput) {
  const material = await materialRepository.createMaterial({
    title: input.title.trim(),
    description: input.description?.trim() || null,
    content: '',
    ownerId: userId,
  });

  return serializeMaterialWithoutGeneratedPack(material);
}

export async function createMaterialFromPdf(
  userId: string,
  input: MaterialInput,
  filePath: string,
  deps: MaterialServiceDeps = defaultDeps
) {
  let content = '';
  try {
    // PDF може бути сканом без текстового шару, тому помилку парсингу
    // перетворюємо на зрозумілу відповідь для користувача.
    content = await deps.pdfExtractor.extractStructuredTextFromPdf(filePath);
  } catch {
    throw new ApplicationError('Не вдалося прочитати PDF. Спробуйте інший файл.', 'unprocessable');
  }

  if (!isContentSufficientForGeneration(content)) {
    throw new ApplicationError(
      `PDF містить замало розпізнаного тексту. Мінімум ${MATERIAL_CONSTRAINTS.CONTENT_MIN} слова.`,
      'unprocessable'
    );
  }

  if (content.length > MATERIAL_CONSTRAINTS.CONTENT_MAX) {
    throw new ApplicationError(
      `PDF містить забагато тексту. Максимум ${MATERIAL_CONSTRAINTS.CONTENT_MAX} символів.`,
      'unprocessable'
    );
  }

  const material = await materialRepository.createMaterial({
    title: input.title.trim(),
    description: input.description?.trim() || null,
    content,
    ownerId: userId,
  });

  return serializeMaterialWithoutGeneratedPack(material);
}

export async function getMaterial(userId: string, id: string) {
  const material = await materialRepository.findMaterialOwned(id, userId);

  if (!material) {
    throw new ApplicationError('Матеріал не знайдено або доступ заборонено', 'not_found');
  }

  return { ...serializeMaterial(material), content: sanitizeMaterialHtml(material.content) };
}

export async function updateMaterial(userId: string, id: string, input: UpdateMaterialInput) {
  const existing = await materialRepository.findMaterialOwned(id, userId);

  if (!existing) {
    throw new ApplicationError('Матеріал не знайдено або доступ заборонено', 'not_found');
  }

  await materialRepository.updateMaterial(id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    // HTML чиститься на сервері, навіть якщо клієнт уже робив sanitizer.
    ...(input.content !== undefined ? { content: sanitizeMaterialHtml(input.content) } : {}),
  });

  return getMaterial(userId, id);
}

export async function deleteMaterial(userId: string, id: string) {
  const existing = await materialRepository.findMaterialOwned(id, userId);

  if (!existing) {
    throw new ApplicationError('Матеріал не знайдено або доступ заборонено', 'not_found');
  }

  await materialRepository.deleteMaterial(id);
  await cacheDelPattern(`stats:user:${userId}:*`);
  return { success: true };
}

export async function enqueueCardsGenerationFromMaterial(
  userId: string,
  materialId: string,
): Promise<{ queued: true; jobId: string; estimatedAvailabilityMinutes: { min: number; max: number } }> {
  await loadGenerationContext(userId, materialId, false);

  const generationLock = await materialRepository.lockGeneration(materialId, userId);
  if (generationLock.count !== 1) {
    throw new ApplicationError(
      'Картки для цього матеріалу вже генеруються або були згенеровані',
      'conflict'
    );
  }

  try {
    const job = await enqueueCardGenerationJob({ userId, materialId });

    return {
      queued: true,
      jobId:  job.jobId,
      estimatedAvailabilityMinutes: { min: 1, max: 3 },
    };
  } catch (err) {
    await materialRepository.resetGenerationLock(materialId, userId);
    throw err;
  }
}

export async function processQueuedCardsGeneration(
  data: CardGenerationJobData,
  deps: MaterialServiceDeps = defaultDeps
): Promise<CardGenerationJobResult> {
  try {
    return await createGeneratedCardsPack(data.userId, data.materialId, deps);
  } catch (err) {
    await materialRepository.markGenerationFailed(
      data.materialId,
      data.userId,
      'Не вдалося згенерувати картки. Спробуйте ще раз.'
    );
    throw err;
  }
}

async function createGeneratedCardsPack(
  userId: string,
  materialId: string,
  deps: MaterialServiceDeps
) {
  const { material, plainContent } = await loadGenerationContext(
    userId,
    materialId,
    true
  );

  // Кількість карток визначає AI за змістом матеріалу без верхнього ліміту.
  const finalCards = await deps.cardGenerator.generateCardsFromMaterialText(plainContent);

  if (finalCards.length === 0) {
    throw new ApplicationError('Не вдалося згенерувати картки з цього тексту', 'unprocessable');
  }

  const pack = await materialRepository.createGeneratedPack({
    userId,
    material: {
      id:          material.id,
      title:       material.title,
      description: material.description,
    },
    cards: finalCards,
    initialUserCardState: SM_INITIAL_STATE,
  });

  await cacheDelPattern(`stats:user:${userId}:*`);

  return {
    pack: {
      id:        pack.id,
      title:     pack.title,
      cardCount: pack.cards.length,
    },
  };
}
