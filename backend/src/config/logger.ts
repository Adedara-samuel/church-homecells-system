import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'chms-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.refreshTokenHash',
      '*.secretKey',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino/file',
        options: { destination: 1 },
      },
});

export type Logger = typeof logger;
