import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    mongoUri: string;
  }
}

let mongod: MongoMemoryServer | undefined;

/** Starts one in-memory MongoDB instance for the whole test run. */
export async function setup(project: TestProject): Promise<void> {
  mongod = await MongoMemoryServer.create();
  project.provide('mongoUri', mongod.getUri());
}

export async function teardown(): Promise<void> {
  await mongod?.stop();
}
