import { useEffect, useRef, useState } from "react";
import type { AlertLevel, DerivedReading } from "../types";

export interface AlertLogEntry {
  id: string;
  level: AlertLevel;
  triggeredAtMs: number;
  capacityPct: number;
  waterLevelM: number;
}

const STORAGE_KEY = "wlms.alertLog.v1";
const MAX_ENTRIES = 50;

function load(): AlertLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entries: AlertLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

/**
 * Records a new entry whenever the alert level *changes* (not on every reading).
 * This is a session-observed log of transitions, surfaced clearly as such in the UI.
 */
export function useAlertLog(reading: DerivedReading | null): AlertLogEntry[] {
  const [log, setLog] = useState<AlertLogEntry[]>(() => load());
  const lastLevelRef = useRef<AlertLevel | null>(null);

  useEffect(() => {
    if (!reading) return;
    if (lastLevelRef.current === reading.alertLevel) return;
    lastLevelRef.current = reading.alertLevel;

    setLog((prev) => {
      const entry: AlertLogEntry = {
        id: `${reading.receivedAtMs}-${reading.alertLevel}`,
        level: reading.alertLevel,
        triggeredAtMs: reading.receivedAtMs,
        capacityPct: reading.capacityPct,
        waterLevelM: reading.waterLevelM,
      };
      const next = [entry, ...prev].slice(0, MAX_ENTRIES);
      persist(next);
      return next;
    });
  }, [reading]);

  return log;
}
