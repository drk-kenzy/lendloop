import { ConvexError } from "convex/values";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_LOAN_DAYS = 30;

export function todayISO(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function assertValidDate(value: string, label: string): void {
  if (!ISO_DATE.test(value)) {
    throw new ConvexError(`INVALID_${label.toUpperCase()}`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ConvexError(`INVALID_${label.toUpperCase()}`);
  }
}

export function daysBetween(fromISO: string, toISO: string): number {
  const ms =
    new Date(`${toISO}T00:00:00Z`).getTime() -
    new Date(`${fromISO}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** Inclusive ranges overlap when each starts before the other ends. */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
