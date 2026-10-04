import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

/** Connects to a dedicated database on the shared test Mongo instance. */
export async function connectTestDatabase(baseUri: string, dbName: string): Promise<void> {
  const uri = baseUri.endsWith('/') ? `${baseUri}${dbName}` : `${baseUri}/${dbName}`;
  await mongoose.connect(uri);
  // Build the indexes declared on every registered model so uniqueness and
  // immutability-guard tests are deterministic.
  await Promise.all(Object.values(mongoose.models).map((registeredModel) => registeredModel.init()));
}

/** Removes all documents from every collection (keeps indexes). */
export async function clearAllCollections(): Promise<void> {
  const { db } = mongoose.connection;
  if (!db) {
    return;
  }
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

/** Drops the test database and closes the connection. */
export async function disconnectTestDatabase(): Promise<void> {
  const { db } = mongoose.connection;
  if (db) {
    await db.dropDatabase();
  }
  await mongoose.disconnect();
}

/**
 * Registers the standard database lifecycle hooks for a test file.
 * Every file gets its own database on the shared in-memory Mongo instance.
 */
export function useTestDatabase(dbName: string): void {
  const mongoUri = inject('mongoUri');

  beforeAll(async () => {
    await connectTestDatabase(mongoUri, dbName);
  });

  beforeEach(async () => {
    await clearAllCollections();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });
}
