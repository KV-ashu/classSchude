/**
 * Thrown when a mutation targets a locked (confirmed) TimetableEntry.
 * The baseline is immutable: locked entries can never be modified or
 * deleted - a new baseline version must be created instead.
 */
export class BaselineImmutableError extends Error {
  constructor(detail: string) {
    super(
      `Baseline is immutable: ${detail}. Locked TimetableEntry documents cannot be modified or deleted - create a new baseline version instead.`,
    );
    this.name = 'BaselineImmutableError';
  }
}

/** Thrown when an AuditLog document is updated or deleted (the log is append-only). */
export class AuditLogImmutableError extends Error {
  constructor(operation: string) {
    super(`AuditLog is append-only: operation '${operation}' is not allowed on audit entries.`);
    this.name = 'AuditLogImmutableError';
  }
}
