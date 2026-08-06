import { SITE_CONFIG } from "../config";
import type { AlertLevel, RawWaterMonitorReading } from "../types";

/** Metres → feet (international foot). */
export const METERS_TO_FEET = 3.28084;

const MM_TO_FT = METERS_TO_FEET / 1000;

/** Staff-gauge water level (ft) from A01 air-gap (mm). */
export function distanceToWaterLevelFt(distanceMm: number): number {
  return SITE_CONFIG.sensorElevationFt - distanceMm * MM_TO_FT;
}

/**
 * Resolves sensor-to-water distance in MILLIMETRES.
 * Prefer the firmware `distance` (mm); convert legacy m/cm fields.
 */
export function resolveDistanceMm(raw: RawWaterMonitorReading): number {
  if (typeof raw.distance === "number") return raw.distance;
  if (typeof raw.distance_m === "number") return raw.distance_m * 1000;
  if (typeof raw.depth_m === "number") return raw.depth_m * 1000;
  if (typeof raw.depth_cm === "number") return raw.depth_cm * 10;
  return NaN;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function resolveDeviceTimeMs(raw: RawWaterMonitorReading): number | null {
  if (typeof raw.timestamp_ms === "number" && Number.isFinite(raw.timestamp_ms)) {
    return raw.timestamp_ms;
  }
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return raw.timestamp;
  }
  if (typeof raw.timestamp === "string") {
    const parsed = parseDeviceTimestamp(raw.timestamp);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function formatDeviceReportedAt(raw: RawWaterMonitorReading): string | null {
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return new Date(raw.timestamp).toLocaleString();
  }
  if (typeof raw.timestamp === "string") return raw.timestamp;
  return raw.updated_at ?? null;
}

function parseDeviceTimestamp(value: string): number | null {
  const match = value
    .trim()
    .match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, dd, mon, yyyy, hh, mm, ss] = match;
  const monthIndex = MONTHS.indexOf(mon);
  if (monthIndex === -1) return null;

  const date = new Date(
    Number(yyyy),
    monthIndex,
    Number(dd),
    Number(hh),
    Number(mm),
    Number(ss),
  );
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Alert from absolute staff-gauge level (ft) with hysteresis so values
 * flickering around a threshold do not chatter Normal↔Warning↔Critical.
 */
export function classifyAlertLevel(
  waterLevelFt: number,
  previous: AlertLevel | null = null,
): AlertLevel {
  const h = SITE_CONFIG.alertHysteresisFt;
  const warn = SITE_CONFIG.warningLevelFt;
  const crit = SITE_CONFIG.criticalLevelFt;

  if (previous === "critical") {
    if (waterLevelFt >= crit - h) return "critical";
    if (waterLevelFt >= warn - h) return "warning";
    return "normal";
  }
  if (previous === "warning") {
    if (waterLevelFt >= crit) return "critical";
    if (waterLevelFt >= warn - h) return "warning";
    return "normal";
  }

  if (waterLevelFt >= crit) return "critical";
  if (waterLevelFt >= warn) return "warning";
  return "normal";
}

/** Capacity % of full reservoir (3220 ft) for a given staff-gauge level. */
export function levelToCapacityPct(waterLevelFt: number): number {
  return clamp((waterLevelFt / SITE_CONFIG.fullCapacityFt) * 100, 0, 100);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  normal: "Normal Level",
  warning: "Warning Level",
  critical: "Critical Level",
};

export const ALERT_LEVEL_ACTION: Record<AlertLevel, string> = {
  normal: "No action required. Continue routine monitoring.",
  warning: `Notify site operator. Level at/above ${SITE_CONFIG.warningLevelFt} ft — prepare contingency / drawdown plan toward FRL ${SITE_CONFIG.fullCapacityFt} ft.`,
  critical: `Immediate inspection required. Level at/above ${SITE_CONFIG.criticalLevelFt} ft (FRL ${SITE_CONFIG.fullCapacityFt} ft). Notify emergency response team.`,
};
