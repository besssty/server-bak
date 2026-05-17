/** Router: statsRouter. */

import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../../../shared/middleware/auth';
import { asyncHandler } from '../../../shared/middleware/errorHandler';
import { getStatsSummary } from '../application/statsService';

export const statsRouter = Router();

statsRouter.get('/summary', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getStatsSummary(req.user!.id));
}));
