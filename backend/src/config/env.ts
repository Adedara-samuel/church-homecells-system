import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from the backend package root regardless of cwd.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Also allow a repo-root .env (useful in the monorepo dev workflow).
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, '');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  // --- Database -----------------------------------------------------------
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/church_homecell'),
  MONGODB_DB_NAME: z.string().optional(),

  // --- URLs ---------------------------------------------------------------
  APP_URL: z.string().url().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  BACKEND_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,https://church-homecells-system-frontend.vercel.app'),

  // --- Auth ---------------------------------------------------------------
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-only-refresh-secret-change-me-please'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanish,

  // --- Rate limiting ------------------------------------------------------
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // --- Cloudinary ---------------------------------------------------------
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('church-homecell'),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(5),

  // --- Payments -----------------------------------------------------------
  PAYMENT_PROVIDER: z.enum(['PAYSTACK', 'FLUTTERWAVE', 'MOCK']).default('MOCK'),
  PAYMENT_CURRENCY: z.string().length(3).default('NGN'),

  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),

  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_BASE_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),

  // --- SMS ----------------------------------------------------------------
  SMS_PROVIDER: z.enum(['TERMII', 'TWILIO', 'MOCK']).default('MOCK'),
  SMS_SENDER_ID: z.string().default('ChurchHC'),
  TERMII_API_KEY: z.string().optional(),
  TERMII_BASE_URL: z.string().url().default('https://api.ng.termii.com'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  /**
   * Public URL the provider calls with the final delivery outcome, e.g.
   * `https://api.your-domain.org/api/v1/sms/webhooks/status`.
   * Leave blank to skip delivery receipts — messages then stay at SENT.
   */
  SMS_STATUS_CALLBACK_URL: z.string().url().optional().or(z.literal('')),
  /** Shared secret appended as `?token=` to the callback URL, verified on receipt. */
  SMS_WEBHOOK_SECRET: z.string().optional(),

  // --- Jobs ---------------------------------------------------------------
  ENABLE_CRON_JOBS: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  CRON_TIMEZONE: z.string().default('Africa/Lagos'),
  CELEBRATION_CRON: z.string().default('0 7 * * *'),
  THRESHOLD_CRON: z.string().default('0 * * * *'),
  RECONCILIATION_CRON: z.string().default('30 1 * * *'),
  ATTENDANCE_REMINDER_CRON: z.string().default('0 20 * * 0,2,4'),
  /** Dues accrual, levy expiry and due-date reminders — daily at 06:30. */
  DUES_CRON: z.string().default('30 6 * * *'),

  // --- Misc ---------------------------------------------------------------
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SEED_DEFAULT_PASSWORD: z.string().min(8).default('ChangeMe#2026'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Thrown rather than `process.exit(1)`: in a serverless container an exit code
  // is reported as an opaque crash, whereas the thrown message reaches the logs.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  // Vercel sets this in every runtime; used to size the DB pool and to keep
  // long-running work (cron jobs) out of a container that gets frozen.
  isServerless: Boolean(process.env.VERCEL),
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => normalizeOrigin(o))
    .filter(Boolean),
  uploadMaxBytes: Math.round(raw.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024),
  cloudinaryConfigured: Boolean(
    raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET,
  ),
};

/**
 * Fail fast in production if the deployment is still using development defaults.
 * A silently insecure production deploy is far worse than a crash on boot.
 */
export function assertProductionSafety(): void {
  if (!env.isProduction) return;
  const problems: string[] = [];
  if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) problems.push('JWT_ACCESS_SECRET');
  if (env.JWT_REFRESH_SECRET.startsWith('dev-only')) problems.push('JWT_REFRESH_SECRET');
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
    problems.push('JWT_ACCESS_SECRET must differ from JWT_REFRESH_SECRET');
  if (problems.length) {
    throw new Error(
      `Refusing to start in production with insecure configuration: ${problems.join(', ')}`,
    );
  }
}

export type Env = typeof env;
