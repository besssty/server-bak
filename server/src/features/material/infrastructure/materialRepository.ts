/** Infrastructure-файл: materialRepository. */

import { prisma } from '../../../shared/utils/prisma';
import type { GeneratedCard } from '../application/ports';

interface CreateMaterialData {
  title: string;
  description: string | null;
  content: string;
  ownerId: string;
}

interface UpdateMaterialData {
  title?: string;
  description?: string | null;
  content?: string;
}

interface InitialUserCardState {
  repetition: number;
  interval: number;
  easeFactor: number;
  isLearned: boolean;
}

export const materialRepository = {
  // Матеріал завжди приватний, тому кожне читання перевіряє ownerId.
  findMaterialOwned(id: string, userId: string) {
    return prisma.material.findFirst({
      where: { id, ownerId: userId },
      include: {
        generatedPack: {
          select: {
            cards: {
              select: {
                id: true,
                userCards: {
                  where: { userId },
                  select: { isLearned: true, nextReviewDate: true },
                },
              },
            },
          },
        },
      },
    });
  },

  findMaterials(userId: string) {
    return prisma.material.findMany({
      where:   { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id:             true,
        title:          true,
        description:    true,
        cardsGenerated: true,
        generationStatus: true,
        generationError: true,
        generatedPackId: true,
        createdAt:      true,
        updatedAt:      true,
        generatedPack: {
          select: {
            cards: {
              select: {
                id: true,
                userCards: {
                  where: { userId },
                  select: { isLearned: true, nextReviewDate: true },
                },
              },
            },
          },
        },
      },
    });
  },

  createMaterial(data: CreateMaterialData) {
    return prisma.material.create({ data });
  },

  updateMaterial(id: string, data: UpdateMaterialData) {
    return prisma.material.update({
      where: { id },
      data,
    });
  },

  deleteMaterial(id: string) {
    return prisma.$transaction(async (tx) => {
      const material = await tx.material.findUnique({
        where: { id },
        select: { generatedPackId: true },
      });

      await tx.material.delete({ where: { id } });

      if (material?.generatedPackId) {
        await tx.pack.deleteMany({ where: { id: material.generatedPackId } });
      }
    });
  },

  lockGeneration(materialId: string, userId: string) {
    // Атомарне оновлення не дає двом паралельним запитам створити два паки.
    return prisma.material.updateMany({
      where: {
        id: materialId,
        ownerId: userId,
        cardsGenerated: false,
        generatedPackId: null,
      },
      data: {
        cardsGenerated: true,
        generationStatus: 'queued',
        generationError: null,
      },
    });
  },

  resetGenerationLock(materialId: string, userId: string) {
    // Блокування знімається тільки якщо pack ще не був прив'язаний до material.
    return prisma.material.updateMany({
      where: { id: materialId, ownerId: userId, generatedPackId: null },
      data: {
        cardsGenerated: false,
        generationStatus: 'idle',
        generationError: null,
      },
    });
  },

  markGenerationFailed(materialId: string, userId: string, errorMessage: string) {
    return prisma.material.updateMany({
      where: { id: materialId, ownerId: userId, generatedPackId: null },
      data: {
        cardsGenerated: false,
        generationStatus: 'failed',
        generationError: errorMessage,
      },
    });
  },

  createGeneratedPack(params: {
    userId: string;
    material: { id: string; title: string; description: string | null };
    cards: GeneratedCard[];
    initialUserCardState: InitialUserCardState;
  }) {
    // Pack, Cards, UserCards і Material.generatedPackId мають змінитися разом.
    return prisma.$transaction(async (tx) => {
      const maxPackOrder = await tx.pack.aggregate({
        where: { createdById: params.userId },
        _max: { order: true },
      });

      const createdPack = await tx.pack.create({
        data: {
          title:       params.material.title,
          description: params.material.description ?? `Матеріал: ${params.material.title}`,
          order:       (maxPackOrder._max.order ?? 0) + 1,
          createdById: params.userId,
          cards: {
            create: params.cards.map((card, idx) => ({
              question: card.question.trim(),
              answer:   card.answer.trim(),
              order:    idx,
            })),
          },
        },
        include: { cards: true },
      });

      await tx.userCard.createMany({
        data: createdPack.cards.map((card) => ({
          userId: params.userId,
          cardId: card.id,
          ...params.initialUserCardState,
          nextReviewDate: new Date(),
        })),
        skipDuplicates: true,
      });

      await tx.material.update({
        where: { id: params.material.id },
        data: {
          cardsGenerated:  true,
          generationStatus: 'completed',
          generationError: null,
          generatedPackId: createdPack.id,
        },
      });

      return createdPack;
    });
  },
};
