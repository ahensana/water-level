import { SITE_CONFIG } from "../config";
import type { DerivedReading, SessionHistoryPoint } from "../types";

/**
 * Client-side session history log.
 *
 * Firebase only ever holds the latest reading - there is no server-side history.
 * To still show a meaningful trend, we record every reading observed while this
 * dashboard is open (sampled, deduplicated) into localStorage. This is explicitly
 * a "session" record, not an authoritative historical archive - the UI labels it
 * as such everywhere it is shown.
 */
export function loadSessionHistory(): SessionHistoryPoint[] {
  try {
    const raw = localStorage.getItem(SITE_CONFIG.sessionHistoryStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionHistoryPoint[];
    if (!Array.isArray(parsed)) return [];
    return pruneOldPoints(parsed);
  } catch {
    return [];
  }
}

export function appendSessionHistory(
  existing: SessionHistoryPoint[],
  reading: DerivedReading,
): SessionHistoryPoint[] {
  const last = existing[existing.length - 1];
  if (last && reading.receivedAtMs - last.t < SITE_CONFIG.sessionHistorySampleIntervalMs) {
    return existing;
  }

  const next: SessionHistoryPoint[] = [
    ...existing,
    {
      t: reading.receivedAtMs,
      waterLevelM: reading.waterLevelM,
      capacityPct: reading.capacityPct,
      distanceM: reading.distanceM,
    },
  ];

  const pruned = pruneOldPoints(next);
  persist(pruned);
  return pruned;
}

function pruneOldPoints(points: SessionHistoryPoint[]): SessionHistoryPoint[] {
  const cutoff = Date.now() - SITE_CONFIG.sessionHistoryRetentionMs;
  return points.filter((p) => p.t >= cutoff);
}

function persist(points: SessionHistoryPoint[]): void {
  try {
    localStorage.setItem(SITE_CONFIG.sessionHistoryStorageKey, JSON.stringify(points));
  } catch {
    // localStorage may be unavailable (e.g. private browsing quota) - degrade silently.
  }
}
