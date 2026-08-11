import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter, requestId, sanitizeInput } from './middleware/security';
import { ok } from './utils/http';

import { attendanceRouter } from './modules/attendance/attendance.controller';
import { areaRouter } from './modules/areas/area.controller';
import { auditRouter } from './modules/audit/audit.controller';
import { authRouter } from './modules/auth/auth.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.controller';
import { financeRouter } from './modules/finance/finance.controller';
import { homecellRouter } from './modules/homecells/homecell.controller';
import { memberRouter } from './modules/members/member.controller';
import { notificationRouter } from './modules/notifications/notification.controller';
import { paymentRouter } from './modules/payments/payment.controller';
import { remittanceRouter } from './modules/remittances/remittance.controller';
import { reportRouter } from './modules/reports/report.controller';
import { settingsRouter } from './modules/settings/settings.controller';
import { smsRouter } from './modules/sms/sms.controller';
import { transferRouter } from './modules/transfers/transfer.controller';
import { uploadRouter } from './modules/uploads/upload.controller';
import { userRouter } from './modules/users/user.controller';
import { zoneRouter } from './modules/zones/zone.controller';

export function createApp(): Application {
  const app = express();

  // Behind a load balancer / reverse proxy, so client IPs and secure-cookie
  // detection come from X-Forwarded-* headers.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: env.isProduction ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server requests carry no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not permitted by CORS policy`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      maxAge: 86_400,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  app.use(
    express.json({
      limit: '2mb',
      // Webhook signatures are computed over the exact bytes received, so the raw
      // body is retained for those routes only.
      verify: (req, _res, buf) => {
        if ((req as Request).originalUrl?.includes('/payments/webhooks/')) {
          (req as Request).rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(sanitizeInput);

  // --- Health & readiness ---------------------------------------------------
  app.get('/health', (_req: Request, res: Response) =>
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }),
  );

  app.get('/ready', (_req: Request, res: Response) => {
    const dbReady = mongoose.connection.readyState === 1;
    return res.status(dbReady ? 200 : 503).json({
      status: dbReady ? 'ready' : 'not-ready',
      database: dbReady ? 'connected' : 'disconnected',
    });
  });

  // --- API ------------------------------------------------------------------
  const api = express.Router();
  api.use(apiLimiter);

  api.get('/', (_req: Request, res: Response) =>
    ok(res, {
      name: 'Church Homecell Management System API',
      version: '1.0.0',
      documentation: '/docs/API.md',
    }),
  );

  api.use('/auth', authRouter);
  api.use('/users', userRouter);
  api.use('/zones', zoneRouter);
  api.use('/areas', areaRouter);
  api.use('/homecells', homecellRouter);
  api.use('/members', memberRouter);
  api.use('/transfers', transferRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/finance', financeRouter);
  api.use('/payments', paymentRouter);
  api.use('/remittances', remittanceRouter);
  api.use('/notifications', notificationRouter);
  api.use('/sms', smsRouter);
  api.use('/reports', reportRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/settings', settingsRouter);
  api.use('/uploads', uploadRouter);
  api.use('/dashboard', dashboardRouter);

  app.use(env.API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.debug({ prefix: env.API_PREFIX }, 'Express application configured');
  return app;
}
