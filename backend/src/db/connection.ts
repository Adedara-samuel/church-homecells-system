import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';

mongoose.set('strictQuery', true);
// `sanitizeFilter` is deliberately NOT enabled: it wraps *every* nested `$`-key in
// `$eq`, which breaks the legitimate `$gte` / `$in` / `$or` operators the service
// layer builds. Injection is prevented at the boundary instead — Zod strips unknown
// keys from every request, and `sanitizeInput` removes `$`-prefixed and dotted keys
// before any value reaches a query.

let connecting: Promise<typeof mongoose> | null = null;

export async function connectDatabase(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (connecting) return connecting;

  connecting = mongoose
    .connect(uri, {
      dbName: env.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 20,
      minPoolSize: 2,
      retryWrites: true,
    })
    .then((m) => {
      logger.info({ host: m.connection.host, db: m.connection.name }, 'MongoDB connected');
      return m;
    })
    .catch((err) => {
      connecting = null;
      logger.error({ err }, 'MongoDB connection failed');
      throw err;
    });

  return connecting;
}

export async function disconnectDatabase(): Promise<void> {
  connecting = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}

mongoose.connection.on('disconnected', () => {
  connecting = null;
  logger.warn('MongoDB disconnected');
});
mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));

/**
 * Replica sets support multi-document transactions; a standalone `mongod` does not.
 * The finance layer needs atomic multi-write behaviour, so it asks this at runtime and
 * degrades to sequential writes (with compensating cleanup) on standalone dev servers.
 */
let transactionSupport: boolean | null = null;

export async function supportsTransactions(): Promise<boolean> {
  if (transactionSupport !== null) return transactionSupport;
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return (transactionSupport = false);
    const info = (await admin.command({ hello: 1 })) as Record<string, unknown>;
    transactionSupport = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch {
    transactionSupport = false;
  }
  if (!transactionSupport) {
    logger.warn(
      'MongoDB deployment does not support multi-document transactions (standalone server). ' +
        'Financial writes will run sequentially with compensating rollback. ' +
        'Use a replica set in production.',
    );
  }
  return transactionSupport;
}

/** Test helper — lets the harness reset the cached capability probe. */
export function resetTransactionSupportCache(): void {
  transactionSupport = null;
}
