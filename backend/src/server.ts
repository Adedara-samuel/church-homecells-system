import type { Server } from 'node:http';
import { createApp } from './app';
import { assertProductionSafety, env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase, supportsTransactions } from './db/connection';
import { startJobs, stopJobs } from './jobs';
import { mailConfigured } from './modules/mail/mail.service';
import { getSettings } from './modules/settings/settings.service';

let server: Server | undefined;

async function bootstrap(): Promise<void> {
  assertProductionSafety();

  await connectDatabase();
  await supportsTransactions();

  // Materialises the settings document on first boot so every module can read it.
  const settings = await getSettings(true);
  logger.info(
    {
      church: settings.churchName,
      paymentProvider: settings.activePaymentProvider,
      smsProvider: settings.activeSmsProvider,
      uploads: env.cloudinaryConfigured ? 'cloudinary' : 'local',
    },
    'System configuration loaded',
  );

  /**
   * The active provider lives in the database, so a correct `PAYMENT_PROVIDER` cannot
   * fix a deployment whose settings document still says MOCK — it would keep issuing
   * mock checkout links. Payments are refused in that state (see `getActiveProvider`),
   * but it is called out here so the cause is visible in the boot logs rather than
   * discovered by a coordinator at checkout.
   */
  /**
   * Celebration greetings go out by email. Without SMTP credentials they are recorded
   * as skipped rather than sent — correct, but silent unless it is said out loud here.
   */
  if (env.isProduction && !mailConfigured() && (settings.birthdaySmsEnabled || settings.anniversarySmsEnabled)) {
    logger.error(
      'Celebration greetings are enabled but no SMTP credentials are configured — ' +
        'members with an email address will not be greeted. Check with: npm run verify:mail',
    );
  }

  if (settings.activePaymentProvider === 'MOCK' && env.isProduction) {
    logger.error(
      { envProvider: env.PAYMENT_PROVIDER },
      'Active payment provider is MOCK in production — online payments are DISABLED. ' +
        'Fix with: npm run set-provider -- PAYSTACK',
    );
  }

  const app = createApp();
  server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, api: `${env.BACKEND_URL}${env.API_PREFIX}` },
      'Church Homecell Management API is listening',
    );
  });

  startJobs();
}

/**
 * Stops accepting new connections, lets in-flight requests finish, then closes the
 * database. A hard exit after 15s guards against a hung connection blocking a deploy.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down gracefully');

  const force = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000);
  force.unref();

  try {
    stopJobs();
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await disconnectDatabase();
    clearTimeout(force);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});

void bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start the application');
  process.exit(1);
});
