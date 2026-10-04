export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** ISO weekday (1 = Monday) to a short label. */
export function dayLabel(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek - 1] ?? 'Day';
}

export function dayShort(dayOfWeek: number): string {
  return dayLabel(dayOfWeek).slice(0, 3);
}

export function formatTimeRange(startTime: string, endTime: string): string {
  return `${startTime} – ${endTime}`;
}

/** '2026-03-10' -> 'Tue, 10 Mar' (UTC based: calendar dates have no timezone). */
export function formatDateLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Today in the user's timezone - the same clock the server resolves dates with. */
export function isoDateInZone(timeZone: string, instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday) of a yyyy-MM-dd string. */
export function isoWeekday(isoDate: string): number {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();
}

export function relativeTime(isoInstant: string): string {
  const deltaMs = Date.now() - new Date(isoInstant).getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

export type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

export function statusTone(status: string): Tone {
  switch (status) {
    case 'SCHEDULED':
    case 'AUTO_APPLIED':
    case 'APPLIED_MANUALLY':
    case 'APPLIED':
      return 'success';
    case 'CANCELLED':
    case 'REJECTED':
    case 'FAILED':
      return 'danger';
    case 'PENDING_REVIEW':
    case 'QUEUED':
    case 'ONLINE':
      return 'warning';
    case 'IGNORED':
    case 'REVERTED':
      return 'neutral';
    default:
      return 'info';
  }
}