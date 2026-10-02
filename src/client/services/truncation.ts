import { useEffect, useState } from "react";

/**
 * ─── Truncation warning store ──────────────────────────────────────────────────
 *
 * Every Table API list query in `services/api.ts` runs with an explicit
 * `sysparm_limit`. When the platform returns exactly as many rows as we asked
 * for, the result set is *potentially* truncated: there may be more records we
 * never saw, and every KPI computed on top of that list is silently partial.
 *
 * `api.ts` reports such detections here (see `registerTruncationWarning`), and
 * the UI subscribes through `useTruncationWarnings()` to show a discreet,
 * non-blocking banner (see `app.tsx`).
 *
 * Deliberately dependency-free: a module-level array + a Set of listeners.
 * No external state library, no context provider needed — the store is a
 * singleton because `api.ts` (which is not a React module) must be able to
 * write to it.
 */

export interface TruncationWarning {
  /** Human-readable context, e.g. "Messaggi" — shown in the UI banner. */
  label: string;
  /** Table the query ran against (for the console diagnostic). */
  table: string;
  /** The `sysparm_limit` that was requested. */
  limit: number;
  /** How many records actually came back (equal to `limit` when truncated). */
  returned: number;
  /** Epoch ms of the first detection for this label/table/limit triple. */
  at: number;
}

let warnings: TruncationWarning[] = [];
const listeners = new Set<(warnings: TruncationWarning[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(warnings);
}

/**
 * Register a truncation detection. Always logs a `console.warn` with the
 * context label, the limit and the table, then notifies subscribers.
 *
 * Identical detections (same label + table + limit) are recorded once, so a
 * view that fires the same query in a loop (e.g. one query per conversation)
 * does not flood the banner or the console.
 */
export function registerTruncationWarning(warning: Omit<TruncationWarning, "at">): void {
  const duplicate = warnings.some(
    (w) => w.label === warning.label && w.table === warning.table && w.limit === warning.limit
  );
  if (duplicate) return;

  console.warn(
    `[truncation] "${warning.label}" returned ${warning.returned} records — ` +
      `the requested limit of ${warning.limit} on table "${warning.table}" was reached, ` +
      `so the data shown may be incomplete.`
  );

  warnings = [...warnings, { ...warning, at: Date.now() }];
  emit();
}

/** Current warnings (immutable snapshot — never mutate the returned array). */
export function getTruncationWarnings(): TruncationWarning[] {
  return warnings;
}

/** Drop every warning. Called when the view changes, alongside queryTracker.reset(). */
export function clearTruncationWarnings(): void {
  if (warnings.length === 0) return;
  warnings = [];
  emit();
}

/**
 * Subscribe to warning changes. Returns the unsubscribe function.
 * Usable outside React as well.
 */
export function subscribeTruncationWarnings(
  listener: (warnings: TruncationWarning[]) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook: re-renders the caller whenever the warning list changes.
 * Subscribes on mount, unsubscribes on unmount.
 */
export function useTruncationWarnings(): TruncationWarning[] {
  const [current, setCurrent] = useState<TruncationWarning[]>(getTruncationWarnings);

  useEffect(() => {
    // Re-sync on mount: a query may have completed between render and effect.
    setCurrent(getTruncationWarnings());
    return subscribeTruncationWarnings((next) => setCurrent(next));
  }, []);

  return current;
}
