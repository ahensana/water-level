/**
 * Minimal persisted store with synchronous reads.
 *
 * Two things in the app need the same shape: the calibration trim and the
 * gauge-verification register. Both must be readable synchronously from pure
 * functions (`distanceToWaterLevelFt` is called per sample, outside React) while
 * still driving re-renders, which is more than `useState` can offer.
 *
 * Every storage access is guarded. A corrupt or unavailable `localStorage` —
 * private browsing, quota, a hand-edited key — must degrade to the fallback
 * value rather than take down a monitoring dashboard.
 */
export interface LocalStore<T> {
  /** Current value. Cheap; safe to call in a hot path. */
  get(): T;
  set(value: T): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export function createLocalStore<T>(
  key: string,
  fallback: T,
  /** Validates and normalises persisted JSON; return null to reject it. */
  revive: (raw: unknown) => T | null,
): LocalStore<T> {
  let current = read();
  const listeners = new Set<() => void>();

  function read(): T {
    if (typeof localStorage === "undefined") return fallback;
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      return revive(JSON.parse(stored)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  return {
    get: () => current,
    set(value: T) {
      current = value;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Keep the in-memory value so the session still behaves correctly,
        // just without persistence.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
