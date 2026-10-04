import mongoose from 'mongoose';

export interface ConnectDatabaseOptions {
  uri: string;
  /** Total connection attempts before giving up. Default 5. */
  maxRetries?: number;
  /** Base delay for the exponential backoff between attempts (ms). Default 500. */
  baseDelayMs?: number;
  /** How long the driver waits for a reachable server per attempt (ms). Default 5000. */
  serverSelectionTimeoutMs?: number;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Connects to MongoDB with bounded retries and exponential backoff.
 * Throws the last connection error when every attempt failed.
 */
export async function connectDatabase(options: ConnectDatabaseOptions): Promise<typeof mongoose> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const serverSelectionTimeoutMs =
    options.serverSelectionTimeoutMs ?? DEFAULT_SERVER_SELECTION_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await mongoose.connect(options.uri, { serverSelectionTimeoutMS: serverSelectionTimeoutMs });
      return mongoose;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        console.warn(
          `[classsync-server] MongoDB connection attempt ${attempt}/${maxRetries} failed; retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('MongoDB connection failed');
}

/** Closes the shared Mongoose connection. Safe to call when already disconnected. */
export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/** True while the shared Mongoose connection is usable. */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
