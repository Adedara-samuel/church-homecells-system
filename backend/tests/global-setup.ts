import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replicaSet: MongoMemoryReplSet | undefined;

/**
 * A single-node **replica set** rather than a standalone server: the finance layer
 * relies on multi-document transactions, and testing against a standalone would
 * silently exercise the degraded fallback path instead of the production one.
 */
export async function setup(): Promise<void> {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  process.env.MONGODB_URI = replicaSet.getUri('chms_test');
  process.env.NODE_ENV = 'test';
}

export async function teardown(): Promise<void> {
  await replicaSet?.stop();
}
