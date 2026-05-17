/** Router: materialRouter. */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../../../shared/middleware/auth';
import { asyncHandler } from '../../../shared/middleware/errorHandler';
import { createRateLimiter } from '../../../shared/middleware/rateLimit';
import { routeParam } from '../../../shared/utils/routeParams';
import {
  createMaterial,
  createMaterialFromPdf,
  deleteMaterial,
  enqueueCardsGenerationFromMaterial,
  getMaterial,
  listMaterials,
  updateMaterial,
} from '../application/materialService';
import { MATERIAL_CONSTRAINTS } from '../domain/materialDomain';
import { cleanupUploadedFile, materialPdfUpload } from '../infrastructure/upload';

export const materialRouter = Router();

const createSchema = z.object({
  title:       z.string().trim().min(1).max(MATERIAL_CONSTRAINTS.TITLE_MAX),
  description: z.string().trim().max(MATERIAL_CONSTRAINTS.DESCRIPTION_MAX).optional(),
});

const createFromFileSchema = z.object({
  title:       z.string().trim().min(1).max(MATERIAL_CONSTRAINTS.TITLE_MAX),
  description: z.string().trim().max(MATERIAL_CONSTRAINTS.DESCRIPTION_MAX).optional(),
});

const updateSchema = z.object({
  title:       z.string().trim().min(1).max(MATERIAL_CONSTRAINTS.TITLE_MAX).optional(),
  description: z.string().trim().max(MATERIAL_CONSTRAINTS.DESCRIPTION_MAX).nullable().optional(),
  content:     z.string().max(MATERIAL_CONSTRAINTS.CONTENT_MAX).optional(),
});

const uploadRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyPrefix: 'materials:upload',
  keyFn: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
});

const generateRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyPrefix: 'materials:generate',
  keyFn: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
});

materialRouter.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  res.json(await listMaterials(req.user!.id));
}));

materialRouter.post('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Невалідні дані' });
    return;
  }

  const material = await createMaterial(req.user!.id, parsed.data);
  res.status(201).json(material);
}));

materialRouter.post(
  '/from-file',
  requireAuth,
  uploadRateLimit,
  materialPdfUpload.single('pdf'),
  asyncHandler(async (req: AuthRequest, res) => {
    const filePath = req.file?.path;

    try {
      if (!req.file) {
        res.status(400).json({ error: 'PDF файл не завантажено' });
        return;
      }

      const parsed = createFromFileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Невалідні дані' });
        return;
      }

      const material = await createMaterialFromPdf(req.user!.id, parsed.data, req.file.path);
      res.status(201).json(material);
    } finally {
      cleanupUploadedFile(filePath);
    }
  })
);

materialRouter.get('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getMaterial(req.user!.id, routeParam(req.params.id)));
}));

materialRouter.put('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Невалідні дані' });
    return;
  }

  res.json(await updateMaterial(req.user!.id, routeParam(req.params.id), parsed.data));
}));

materialRouter.delete('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  res.json(await deleteMaterial(req.user!.id, routeParam(req.params.id)));
}));

materialRouter.post('/:id/generate', requireAuth, generateRateLimit, asyncHandler(async (req: AuthRequest, res) => {
  const result = await enqueueCardsGenerationFromMaterial(
    req.user!.id,
    routeParam(req.params.id)
  );

  res.status(202).json(result);
}));
