import mongoose, { type ClientSession } from 'mongoose';
import { logger } from '../config/logger';
import { supportsTransactions } from './connection';

export interface UnitOfWork {
  session: ClientSession | undefined;
  /**
   * Registers an undo action used only when the deployment cannot provide real
   * transactions. On a replica set these are never invoked — the session aborts instead.
   */
  onRollback(fn: () => Promise<void>): void;
}

/**
 * Runs `work` atomically.
 *
 * On a replica set (the production topology) this is a genuine multi-document
 * transaction: everything commits or nothing does. On a standalone development
 * `mongod`, which cannot start a transaction, it degrades to sequential writes plus
 * explicit compensating actions registered through `onRollback`, so a partial
 * financial state is still never left behind.
 */
export async function withTransaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
  const transactional = await supportsTransactions();

  if (!transactional) {
    const compensations: (() => Promise<void>)[] = [];
    const uow: UnitOfWork = {
      session: undefined,
      onRollback: (fn) => compensations.push(fn),
    };
    try {
      return await work(uow);
    } catch (err) {
      // Undo in reverse order so later writes are removed before the ones they depend on.
      for (const compensate of compensations.reverse()) {
        try {
          await compensate();
        } catch (compensationError) {
          logger.error(
            { err: compensationError },
            'Compensating rollback failed — manual reconciliation may be required',
          );
        }
      }
      throw err;
    }
  }

  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await work({ session, onRollback: () => undefined });
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
