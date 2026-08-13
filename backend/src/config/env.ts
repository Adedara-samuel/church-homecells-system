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

/**
 * A token lifetime, as a number and a unit — `15m`, `2d`.
 *
 * Validated rather than parsed leniently: a bare `2` carries no unit, so the parser
 * cannot tell two seconds from two days and quietly falls back to a default. A session
 * length that silently differs from what the configuration says is exactly the kind of
 * thing nobody notices until it matters.
 */
const duration = z
  .string()
  .regex(/^\d+[smhd]$/, 'must be a number followed by s, m, h or d — for example 15m or 2d');

/** Configuration problems worth shouting about that do not justify refusing to boot. */
const configWarnings: string[] = [];

/**
 * A webhook *secret* is a signing key, never an address.
 *
 * Putting the webhook URL here is an easy mistake — the dashboard field next to it
 * asks for exactly that — and the damage would otherwise be silent: the HMAC would be
 * computed with the URL as its key, so every genuine provider signature fails and no
 * payment ever settles.
 *
 * A URL is definitively not a signing secret, and there *is* a correct fallback — the
 * provider secret key, which is what the provider signs with. So the value is discarded
 * and the fallback used, loudly. Refusing to boot would take attendance, members and
 * every other module offline over a payments setting that can be safely ignored.
 */
const webhookSecret = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) {
      configWarnings.push(
        `${String(ctx.path[0] ?? 'A webhook secret')} looks like a URL, not a signing secret. ` +
          'It has been ignored — signatures are verified with the provider secret key, ' +
          'which is what the provider signs with. Clear the variable to silence this.',
      );
      return undefined;
    }
    return trimmed;
  });

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
  JWT_ACCESS_TTL: duration.default('15m'),
  /**
   * How long a signed-in session survives. The access token keeps refreshing silently
   * within this window; once it passes, the user signs in again.
   */
  JWT_REFRESH_TTL: duration.default('2d'),
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
  PAYSTACK_WEBHOOK_SECRET: webhookSecret,

  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_BASE_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  FLUTTERWAVE_WEBHOOK_SECRET: webhookSecret,

  // --- Email ----------------------------------------------------------------
  // Leave SMTP_HOST blank to render and log celebration emails without sending them.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Defaults to true on port 465 (implicit TLS), false elsewhere (STARTTLS). */
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1')),
  MAIL_FROM_NAME: z.string().default('Church Homecell'),
  MAIL_FROM_ADDRESS: z.string().email().default('no-reply@example.org'),
  MAIL_REPLY_TO: z.string().email().optional().or(z.literal('')),

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

// Printed with `console.error` rather than the logger: this module is imported by the
// logger itself, so it cannot depend on it.
for (const warning of configWarnings) {
  // eslint-disable-next-line no-console
  console.error(`Configuration warning: ${warning}`);
}

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

  /**
   * A local URL in production is not cosmetic: `FRONTEND_URL` becomes the payment
   * provider's `callback_url`, so a coordinator finishing a real payment would be
   * redirected to a machine that is not theirs. Caught at boot rather than discovered
   * mid-checkout.
   */
  const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(url);
  if (isLocal(env.FRONTEND_URL)) problems.push('FRONTEND_URL still points at localhost');
  if (isLocal(env.BACKEND_URL)) problems.push('BACKEND_URL still points at localhost');
  if (isLocal(env.APP_URL)) problems.push('APP_URL still points at localhost');
  if (env.corsOrigins.length === 0) problems.push('CORS_ORIGINS is empty');

  // The mock provider fabricates successful payments — it must never be the intended
  // choice in production, even before the database setting is consulted.
  if (env.PAYMENT_PROVIDER === 'MOCK') {
    problems.push('PAYMENT_PROVIDER is MOCK — set PAYSTACK or FLUTTERWAVE');
  }

  if (problems.length) {
    throw new Error(
      `Refusing to start in production with insecure configuration: ${problems.join(', ')}`,
    );
  }
}

export type Env = typeof env;
