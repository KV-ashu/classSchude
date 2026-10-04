import type { DestinationStream } from 'pino';
import pino from 'pino';
import { env } from './env';

/**
 * Fields that must never reach the log stream: credentials, tokens and the
 * raw message/payload bodies. Pino redacts them at write time, so even an
 * accidental `logger.info({ password })` is safe.
 */
const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'rawText',
  '*.rawText',
  'imageBase64',
  '*.imageBase64',
  'metadata',
  '*.metadata',
];

export function createLogger(destination?: DestinationStream) {
  return pino(
    {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      base: { service: 'classsync-server' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}

export const logger = createLogger();

export type Logger = ReturnType<typeof createLogger>;