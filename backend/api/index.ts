import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Application } from 'express';
import { createApp } from '../src/app';
import { assertProductionSafety } from '../src/config/env';
import { logger } from '../src/config/logger';
import { connectDatabase } from '../src/db/connection';

/**
 * Vercel serverless entry point.
 *
 * Vercel requires a *default export* that is a request handler (or a server) — a
 * module that only exports `createApp` is rejected with "Invalid export found in
 * module". `server.ts` is the long-running counterpart used outside Vercel; it
 * calls `app.listen()`, which a serverless function must never do.
 *
 * The Express app and the Mongo connection are built once per warm container and
 * reused across invocations; a cold start pays for both, a warm one for neither.
 * Cron jobs are deliberately not started here — serverless containers are frozen
 * between requests, so scheduled work belongs in Vercel Cron or a worker process.
 */
let app: Application | undefined;
let booting: Promise<Application> | undefined;

async function boot(): Promise<Application> {
  assertProductionSafety();
  await connectDatabase();
  app = createApp();
  logger.info('Serverless handler ready');
  return app;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!app) {
    // A failed boot must not be cached, otherwise every later invocation on this
    // container replays the same rejected promise (e.g. a transient DB timeout).
    booting ??= boot().catch((err) => {
      booting = undefined;
      throw err;
    });
    try {
      await booting;
    } catch (err) {
      logger.fatal({ err }, 'Failed to initialise the serverless application');
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'The API is starting up or misconfigured.' },
        }),
      );
      return;
    }
  }

  app!(req as never, res as never);
}
