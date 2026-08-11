import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import { upcomingCelebrations } from '../members/member.service';
import { getDashboard } from './dashboard.service';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

/**
 * A single endpoint serves all five role dashboards. The response is shaped by the
 * caller's organisational scope, so the frontend renders the same components with
 * different data rather than maintaining five parallel implementations.
 */
dashboardRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => ok(res, await getDashboard(currentUser(req)))),
);

dashboardRouter.get(
  '/celebrations',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await upcomingCelebrations(
        currentUser(req),
        (req.query as unknown as { days: number }).days,
      ),
    ),
  ),
);
