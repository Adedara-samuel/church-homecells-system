import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middleware/authenticate';
import { authLimiter } from '../../middleware/security';
import { validate } from '../../middleware/validate';
import {
  changePasswordController,
  forgotPasswordController,
  loginController,
  logoutController,
  refreshController,
  resetPasswordController,
  sessionController,
} from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
} from './auth.schemas';

export const authRouter = Router();

authRouter.post('/login', authLimiter, validate({ body: loginSchema }), loginController);
authRouter.post('/refresh', validate({ body: refreshSchema }), refreshController);
authRouter.post('/logout', optionalAuthenticate, logoutController);
authRouter.get('/session', authenticate, sessionController);

authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  changePasswordController,
);
authRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPasswordController,
);
authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  resetPasswordController,
);
