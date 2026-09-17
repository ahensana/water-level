import { useEffect, useState } from "react";

/**
 * Ticking current time for windowed calculations (e.g. "last 24h", ETA
 * projections). A plain `Date.now()` call in a component body is impure —
 * React may invoke render more than once per commit, so a value that only
 * changes via a wall-clock read outside of state won't reliably update or
 * replay consistently. Same reasoning as useClock, at a coarser interval
 * since these panels don't need second-level precision.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
