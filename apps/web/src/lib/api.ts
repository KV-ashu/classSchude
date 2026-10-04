const TOKEN_KEY = 'classsync.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  college: string | null;
  timezone: string;
}

export interface EffectiveEntry {
  entryId: string;
  courseId: string;
  courseCode: string | null;
  courseName: string | null;
  day: number;
  startTime: string;
  endTime: string;
  room: string | null;
  kind: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'ONLINE';
  changeId: string | null;
  changed: boolean;
  /** Baseline start of a rescheduled class so the UI can render old -> new. */
  previousStartTime: string | null;
}

export interface EffectiveDay {
  occurrenceDate: string;
  version: number;
  entries: EffectiveEntry[];
}

export interface ScheduleChangeDto {
  id: string;
  action: string;
  status: string;
  confidence: number;
  occurrenceDate: string;
  rawMessageId: string;
  targetEntryId: string;
  oldValue: { startTime?: string; endTime?: string; room?: string; kind?: string } | null;
  newValue: { startTime?: string; endTime?: string; room?: string; kind?: string } | null;
  appliedBy: string;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  sourceKind: string;
  senderName: string | null;
  groupName: string | null;
  timestamp: string;
  rawText: string;
  status: string;
  processingErrors: string[];
}

export interface AuditEntryDto {
  id: string;
  actor: string;
  action: string;
  changeId: string | null;
  occurrenceDate: string | null;
  reason: string | null;
  createdAt: string;
}

export interface SimulateResult {
  mode: string;
  ingested: (MessageDto & { created: boolean })[];
  createdCount: number;
  duplicateCount: number;
  remaining: number;
}

export interface ScenarioMessage {
  index: number;
  senderName: string;
  groupName: string;
  minutesAgo: number;
  text: string;
}

interface ApiSuccess<T> {
  ok: true;
  data: T;
}
interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const body = (await response.json().catch(() => null)) as ApiSuccess<T> | ApiFailure | null;

  if (!response.ok || body === null || body.ok === false) {
    const failure = body && 'error' in body ? body.error : null;
    throw new ApiError(
      response.status,
      failure?.code ?? 'UNKNOWN_ERROR',
      failure?.message ?? `Request failed (${response.status})`,
    );
  }

  return body.data;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};